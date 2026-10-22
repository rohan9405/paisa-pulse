package dev.paisapulse.app;

import android.content.Context;
import android.content.ComponentName;
import android.appwidget.AppWidgetManager;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/** Personal derived totals only; no transactions or SMS are copied out of IndexedDB. */
final class WidgetBridge {
    private final Context context;
    WidgetBridge(Context context) { this.context = context.getApplicationContext(); }

    @JavascriptInterface
    public boolean canPin() {
        return AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported();
    }

    @JavascriptInterface
    public void requestPin() {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager.isRequestPinAppWidgetSupported()) manager.requestPinAppWidget(new ComponentName(context, DripWidgetProvider.class), null, null);
    }

    @JavascriptInterface
    public void update(String snapshot) {
        try {
            if (snapshot.length() > 100_000) return;
            JSONObject data = new JSONObject(snapshot);
            if (data.optInt("version") != 1 || data.optJSONArray("rows") == null) return;
            context.getSharedPreferences("widget", 0).edit().putString("snapshot", snapshot).apply();
            DripWidgetProvider.refresh(context);
        } catch (Exception ignored) { /* Keep the last valid snapshot. */ }
    }

    @JavascriptInterface
    public void clear() {
        context.getSharedPreferences("widget", 0).edit().clear().apply();
        DripWidgetProvider.refresh(context);
    }
}
