package dev.paisapulse.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the static Next.js export (assets/web) in a WebView on a private
 * https origin, so IndexedDB and client routing work exactly as in a browser.
 * Every request to that origin is answered from the APK; nothing is fetched.
 */
public class MainActivity extends Activity {
    static final String HOST = "paisapulse.local";
    static final int SMS_REQUEST = 1;
    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(0xff07070a);
        getWindow().setNavigationBarColor(0xff07070a);

        web = new WebView(this);
        web.setBackgroundColor(0xff07070a);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new SmsBridge(this), "PaisaSms");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri url = req.getUrl();
                if (!HOST.equals(url.getHost())) return blocked();
                return serve(url.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (HOST.equals(req.getUrl().getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl()));
                } catch (Exception ignored) {
                    // No app for that link; stay put.
                }
                return true;
            }
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl("https://" + HOST + "/");

        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.READ_SMS}, SMS_REQUEST);
        }
    }

    private WebResourceResponse serve(String path) {
        String p = path == null || path.isEmpty() ? "" : path.substring(1);
        String[] candidates = p.isEmpty() || p.endsWith("/")
                ? new String[] {p + "index.html"}
                : new String[] {p, p + "/index.html", p + ".html"};
        for (String c : candidates) {
            WebResourceResponse r = asset(c, 200, "OK");
            if (r != null) return r;
        }
        WebResourceResponse notFound = asset("404.html", 404, "Not Found");
        return notFound != null ? notFound : blocked();
    }

    private WebResourceResponse asset(String name, int status, String reason) {
        InputStream in;
        try {
            in = getAssets().open("web/" + name);
        } catch (IOException e) {
            return null;
        }
        String mime = mime(name);
        boolean text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("svg+xml");
        Map<String, String> headers = new HashMap<>();
        // Hashed build assets never change; pages must always be fresh after an update.
        headers.put("Cache-Control", name.startsWith("_next/static/") ? "public, max-age=31536000, immutable" : "no-cache");
        return new WebResourceResponse(mime, text ? "utf-8" : null, status, reason, headers, in);
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt")) return "text/x-component";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private void emit(String event) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == SMS_REQUEST) emit("paisa-sms-permission");
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        emit("paisa-resume");
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
