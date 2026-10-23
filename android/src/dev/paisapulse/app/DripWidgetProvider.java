package dev.paisapulse.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real launcher views: native text, individually tappable calendar days and refresh. */
public final class DripWidgetProvider extends AppWidgetProvider {
    static final String REFRESH = "dev.paisapulse.app.WIDGET_REFRESH";
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final Locale INDIA = new Locale("en", "IN");
    private static final int WHITE = Color.rgb(244,244,247), MUTED = Color.rgb(150,150,168);
    private static final int LIME = Color.rgb(198,255,61), CORAL = Color.rgb(255,107,107);

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) update(c,m,id);
        WidgetSyncService.schedule(c);
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle options) { update(c,m,id); }
    @Override public void onReceive(Context c, Intent intent) {
        super.onReceive(c,intent);
        String a=intent.getAction();
        if (REFRESH.equals(a) || Intent.ACTION_DATE_CHANGED.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            WidgetSyncService.schedule(c);
            refresh(c);
        }
    }
    @Override public void onDisabled(Context c) { WidgetSyncService.cancel(c); }
    static boolean hasWidgets(Context c) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,DripWidgetProvider.class)).length>0;
    }
    static void refresh(Context c) {
        AppWidgetManager m=AppWidgetManager.getInstance(c);
        for(int id:m.getAppWidgetIds(new ComponentName(c,DripWidgetProvider.class))) update(c,m,id);
    }
    private static void update(Context c,AppWidgetManager manager,int id) {
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.drip_widget);
        LocalDate today=LocalDate.now(IST);
        JSONObject snapshot=readSnapshot(c);
        Map<String,JSONObject> rows=rows(snapshot);
        JSONObject row=rows.get(today.toString());
        boolean locked=c.getSharedPreferences("device",0).getBoolean("appLock",false);
        PendingIntent open=open(c,"/");
        v.setOnClickPendingIntent(R.id.widget_root,open);
        if(locked || row==null) {
            v.setViewVisibility(R.id.widget_data,View.GONE);
            v.setViewVisibility(R.id.widget_empty,View.VISIBLE);
            v.setTextViewText(R.id.widget_empty_title,locked?"Figures hidden":snapshot==null?"Your daily drip":"Time for a sync");
            v.setTextViewText(R.id.widget_empty_hint,locked?"App lock is on · tap to unlock":"Tap to open drip and set up your budget");
        } else {
            v.setViewVisibility(R.id.widget_data,View.VISIBLE);
            v.setViewVisibility(R.id.widget_empty,View.GONE);
            boolean budget=row.optBoolean("budget");
            long available=row.optLong("available"),spent=row.optLong("spent"),dayBudget=row.optLong("dayBudget");
            v.setTextViewText(R.id.widget_date,today.format(DateTimeFormatter.ofPattern("EEE d",INDIA)).toUpperCase(INDIA));
            v.setTextViewText(R.id.widget_label,budget?(available<0?"Over budget by":"Left today"):"Spent today");
            v.setTextViewText(R.id.widget_amount,money(budget?Math.abs(available):spent));
            v.setTextColor(R.id.widget_amount,budget && available<0?CORAL:WHITE);
            v.setTextViewText(R.id.widget_allowance,budget?"of "+money(dayBudget):"Tracking only");
            v.setTextViewText(R.id.widget_spent,budget?money(spent)+" spent today":"No daily limit");
            float fraction=!budget || dayBudget<=0?0:Math.max(0,Math.min(1,available/(float)dayBudget));
            // Only the proportional drop illustration is rasterised; text/layout never are.
            v.setImageViewBitmap(R.id.widget_drop,drop(fraction,budget && available<0?CORAL:LIME));
            v.setOnClickPendingIntent(R.id.widget_today,open);
            String captured=snapshot.optString("capturedDate");
            String updated="earlier";
            try { updated=java.time.Instant.ofEpochMilli(snapshot.optLong("updatedAt")).atZone(IST)
                    .format(DateTimeFormatter.ofPattern(today.toString().equals(captured)?"h:mm a":"d MMM, h:mm a",INDIA)); }
            catch(Exception ignored) {}
            String status=c.getSharedPreferences("widget",0).getString("syncStatus","");
            v.setTextViewText(R.id.widget_updated,"syncing".equals(status)?"Refreshing…":"error".equals(status)?"Tap ↻ to retry":
                    today.toString().equals(captured)?"Updated "+updated:"Estimate · tap ↻");
            Intent refresh=new Intent(c,DripWidgetProvider.class).setAction(REFRESH);
            v.setOnClickPendingIntent(R.id.widget_refresh,PendingIntent.getBroadcast(c,0,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            long monthSpent=0; int under=0;
            for(Map.Entry<String,JSONObject> entry:rows.entrySet()) {
                String date=entry.getKey();
                if(!date.startsWith(today.toString().substring(0,7)) || date.compareTo(today.toString())>0 || date.compareTo(captured)>0) continue;
                monthSpent+=entry.getValue().optLong("spent");
                if(budget && date.compareTo(today.toString())<0 && entry.getValue().optBoolean("budget") && entry.getValue().optBoolean("under")) under++;
            }
            v.setTextViewText(R.id.widget_month,today.format(DateTimeFormatter.ofPattern("MMM",INDIA)).toUpperCase(INDIA));
            v.setTextViewText(R.id.widget_under,budget?under+" under":"This month");
            v.setTextViewText(R.id.widget_month_spent,money(monthSpent));
            v.setOnClickPendingIntent(R.id.widget_month_total,open(c,"/dashboard/"));
            v.setOnClickPendingIntent(R.id.widget_month_header,open(c,"/briefing/"));
            calendar(c,v,today,captured,rows);
        }
        manager.updateAppWidget(id,v);
    }
    private static void calendar(Context c,RemoteViews v,LocalDate today,String captured,Map<String,JSONObject> rows) {
        v.removeAllViews(R.id.widget_weekdays); v.removeAllViews(R.id.widget_calendar);
        for(String label:new String[]{"M","T","W","T","F","S","S"}) {
            RemoteViews day=new RemoteViews(c.getPackageName(),R.layout.drip_widget_day);
            day.setTextViewText(R.id.widget_day,label);
            v.addView(R.id.widget_weekdays,day);
        }
        int offset=today.withDayOfMonth(1).getDayOfWeek().getValue()-1;
        int weeks=(offset+today.lengthOfMonth()+6)/7;
        for(int w=0;w<weeks;w++) {
            RemoteViews week=new RemoteViews(c.getPackageName(),R.layout.drip_widget_week);
            for(int col=0;col<7;col++) {
                int n=w*7+col-offset+1;
                RemoteViews cell=new RemoteViews(c.getPackageName(),R.layout.drip_widget_day);
                if(n>=1 && n<=today.lengthOfMonth()) {
                    LocalDate date=today.withDayOfMonth(n);
                    JSONObject row=rows.get(date.toString());
                    boolean observed=row!=null && !date.isAfter(today) && date.toString().compareTo(captured)<=0;
                    int background=R.drawable.widget_day_neutral,fg=MUTED;
                    String state="not tracked";
                    if(observed) {
                        boolean budget=row.optBoolean("budget"),under=row.optBoolean("under");
                        background=!budget?R.drawable.widget_day_tracking:under?R.drawable.widget_day_under:R.drawable.widget_day_over;
                        fg=!budget?Color.rgb(213,192,255):under?Color.rgb(224,255,154):Color.rgb(255,202,202);
                        state=!budget?"spending recorded":under?"under budget":"over budget";
                    }
                    if(date.equals(today)){background=R.drawable.widget_day_today;fg=Color.rgb(19,19,26);}
                    cell.setTextViewText(R.id.widget_day,String.valueOf(n));
                    cell.setTextColor(R.id.widget_day,fg);
                    cell.setInt(R.id.widget_day,"setBackgroundResource",background);
                    cell.setContentDescription(R.id.widget_day,date+", "+state+(observed?", tap for day report":""));
                    if(observed) cell.setOnClickPendingIntent(R.id.widget_day,open(c,"/briefing/?day="+date));
                }
                week.addView(R.id.widget_week,cell);
            }
            v.addView(R.id.widget_calendar,week);
        }
    }
    private static PendingIntent open(Context c,String route) {
        Intent i=new Intent(c,MainActivity.class).setAction("dev.paisapulse.app.WIDGET_OPEN")
                .setData(android.net.Uri.parse("drip://widget"+route)).putExtra("widgetRoute",route)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static Bitmap drop(float fraction,int color) {
        Bitmap b=Bitmap.createBitmap(128,160,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(b); canvas.scale(2,2);
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG); Path path=new Path();
        path.moveTo(32,2); path.cubicTo(32,2,6,32,6,49); path.cubicTo(6,84,58,84,58,49); path.cubicTo(58,32,32,2,32,2); path.close();
        p.setColor(Color.rgb(48,48,58)); canvas.drawPath(path,p); canvas.clipPath(path); p.setColor(color);
        if(fraction>0) canvas.drawRect(0,fraction>=1?0:77*(1-(float)Math.sqrt(fraction)),64,80,p);
        return b;
    }
    private static JSONObject readSnapshot(Context c) {
        try{return new JSONObject(c.getSharedPreferences("widget",0).getString("snapshot",""));}catch(Exception e){return null;}
    }
    private static Map<String,JSONObject> rows(JSONObject s) {
        Map<String,JSONObject> out=new HashMap<>(); JSONArray rows=s==null?null:s.optJSONArray("rows");
        if(rows!=null) for(int i=0;i<rows.length();i++){JSONObject r=rows.optJSONObject(i);if(r!=null)out.put(r.optString("date"),r);}
        return out;
    }
    private static String money(long paise) {
        String s=Long.toString(Math.abs(paise)/100);
        if(s.length()>3){String tail=s.substring(s.length()-3),head=s.substring(0,s.length()-3);s=head.replaceAll("\\B(?=(\\d{2})+(?!\\d))",",")+","+tail;}
        return "₹"+s;
    }
}
