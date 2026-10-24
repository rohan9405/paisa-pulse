package dev.paisapulse.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * `window.PaisaSms` in the page (see src/data/providers/sms.ts).
 * Read-only: lists inbox messages; parsing and storage happen in the page.
 */
final class SmsBridge {
    private static final Uri INBOX = Uri.parse("content://sms/inbox");
    private final Context activity;

    SmsBridge(Context activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean hasPermission() {
        return activity.getSharedPreferences("privacy", 0).getInt("smsConsent", 0) >= 1
            && activity.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
            && activity.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestPermission() {
        if (activity instanceof MainActivity) {
            MainActivity screen = (MainActivity) activity;
            screen.runOnUiThread(screen::requestSmsAccess);
        }
    }

    /**
     * Inbox rows received after {@code sinceMs}, oldest first, scanning at most {@code limit} rows.
     * Personal senders (phone numbers) are dropped here so their texts never reach the page.
     * Returns {"messages":[{id,address,body,date}], "until": last scanned date, "more": bool}.
     */
    @JavascriptInterface
    public String list(long sinceMs, int limit) throws JSONException {
        JSONArray messages = new JSONArray();
        long until = sinceMs;
        int scanned = 0;
        boolean more = false;
        if (hasPermission()) {
            try (Cursor c = activity.getContentResolver().query(INBOX, new String[] {"_id", "address", "body", "date"},
                    "date > ?", new String[] {String.valueOf(sinceMs)}, "date ASC")) {
                while (c != null && c.moveToNext()) {
                    if (scanned == limit) {
                        more = true;
                        break;
                    }
                    scanned++;
                    String address = c.getString(1);
                    until = c.getLong(3);
                    if (address == null || address.matches("^\\+?[\\d\\s-]+$")) continue;
                    JSONObject m = new JSONObject();
                    m.put("id", c.getString(0));
                    m.put("address", address);
                    m.put("body", c.getString(2) == null ? "" : c.getString(2));
                    m.put("date", until);
                    messages.put(m);
                }
            }
        }
        JSONObject out = new JSONObject();
        out.put("messages", messages);
        out.put("until", until);
        out.put("more", more);
        return out.toString();
    }
}
