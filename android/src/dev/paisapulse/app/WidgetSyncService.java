package dev.paisapulse.app;

import android.Manifest;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;

/** A short local job reuses the exact JS parser/IndexedDB/budget engine, then shuts down. */
public final class WidgetSyncService extends JobService {
    private static final int JOB_ID=4052;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private WebView web;
    private JobParameters running;
    private final Runnable timeout=()->finish(false);

    static void schedule(Context c) {
        if(!DripWidgetProvider.hasWidgets(c) || !new SmsBridge(c).hasPermission()) return;
        JobScheduler jobs=(JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);
        if(jobs.getPendingJob(JOB_ID)!=null) return;
        JobInfo.Builder b=new JobInfo.Builder(JOB_ID,new ComponentName(c,WidgetSyncService.class));
        if(Build.VERSION.SDK_INT>=31)b.setExpedited(true);else b.setOverrideDeadline(0);
        int result=jobs.schedule(b.build());
        if(result==JobScheduler.RESULT_FAILURE && Build.VERSION.SDK_INT>=31) {
            b.setExpedited(false).setOverrideDeadline(0); result=jobs.schedule(b.build());
        }
        if(result==JobScheduler.RESULT_SUCCESS) {
            c.getSharedPreferences("widget",0).edit().putString("syncStatus","syncing").apply();
            DripWidgetProvider.refresh(c);
        }
    }
    static void cancel(Context c) { ((JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE)).cancel(JOB_ID); }
    @Override public boolean onStartJob(JobParameters p) {
        if(!new SmsBridge(this).hasPermission()) {
            getSharedPreferences("widget",0).edit().putString("syncStatus","error").apply();
            DripWidgetProvider.refresh(this);return false;
        }
        running=p;
        web=new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new SmsBridge(this),"PaisaSms");
        web.addJavascriptInterface(new WidgetBridge(this),"PaisaWidget");
        web.addJavascriptInterface(new Completion(),"PaisaWidgetJob");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest req) {
                if(!MainActivity.HOST.equals(req.getUrl().getHost()))return blocked();
                String path=req.getUrl().getPath();
                String name=path==null?"":path.replaceFirst("^/","");
                if(name.contains(".."))return blocked();
                String[] candidates=name.endsWith("/")?new String[]{name+"index.html"}:new String[]{name,name+"/index.html"};
                for(String file:candidates)try {
                    InputStream in=getAssets().open("web/"+file);
                    String mime=file.endsWith(".html")?"text/html":file.endsWith(".js")?"application/javascript":
                            file.endsWith(".css")?"text/css":file.endsWith(".txt")?"text/x-component":file.endsWith(".json")?"application/json":
                            file.endsWith(".woff2")?"font/woff2":"application/octet-stream";
                    return new WebResourceResponse(mime,"utf-8",in);
                }catch(Exception ignored){}
                return blocked();
            }
        });
        handler.postDelayed(timeout,25_000);
        web.loadUrl("https://"+MainActivity.HOST+"/widget-sync/");
        return true;
    }
    public final class Completion {
        @JavascriptInterface public void finish(boolean ok) { handler.post(()->WidgetSyncService.this.finish(ok)); }
    }
    private void finish(boolean ok) {
        if(running==null)return;
        JobParameters p=running;running=null;
        getSharedPreferences("widget",0).edit().putString("syncStatus",ok?"":"error").apply();
        cleanup();DripWidgetProvider.refresh(this);jobFinished(p,false);
    }
    private void cleanup() {
        handler.removeCallbacks(timeout);
        if(web!=null){web.stopLoading();web.destroy();web=null;}
    }
    @Override public boolean onStopJob(JobParameters p) {
        running=null;cleanup();
        getSharedPreferences("widget",0).edit().putString("syncStatus","").apply();
        DripWidgetProvider.refresh(this);return false;
    }
    @Override public void onDestroy(){cleanup();super.onDestroy();}
    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain","utf-8",403,"Forbidden",new HashMap<String,String>(),new ByteArrayInputStream(new byte[0]));
    }
}
