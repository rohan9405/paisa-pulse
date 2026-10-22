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
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.RemoteViews;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native 4 x 2 launcher widget. Reads cached totals; never starts SMS/background WebView work. */
public final class DripWidgetProvider extends AppWidgetProvider {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final Locale INDIA = new Locale("en", "IN");
    private static final int PANEL = Color.rgb(19, 19, 26);
    private static final int WHITE = Color.rgb(244, 244, 247);
    private static final int MUTED = Color.rgb(150, 150, 168);
    private static final int LIME = Color.rgb(198, 255, 61);
    private static final int CORAL = Color.rgb(255, 107, 107);

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (Intent.ACTION_DATE_CHANGED.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) refresh(context);
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, DripWidgetProvider.class))) update(context, manager, id);
    }

    private static void update(Context context, AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        // Use the launcher's size in the current orientation, with a conservative bitmap budget.
        boolean landscape = context.getResources().getConfiguration().orientation == 2;
        int width = options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 340);
        int height = options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180);
        width = Math.max(250, Math.min(width, 600));
        height = Math.max(110, Math.min(height, 400));
        android.util.DisplayMetrics display = context.getResources().getDisplayMetrics();
        // RemoteViews has a per-update bitmap budget based on the physical screen.
        float rasterScale = Math.min(2f, (float) Math.sqrt((double) display.widthPixels * display.heightPixels / (width * height)));
        Bitmap bitmap = Bitmap.createBitmap(Math.max(1, (int) (width * rasterScale)), Math.max(1, (int) (height * rasterScale)), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(PANEL);
        canvas.drawRoundRect(new RectF(0, 0, bitmap.getWidth(), bitmap.getHeight()), 48, 48, paint);
        float scale = Math.min(bitmap.getWidth() / 360f, bitmap.getHeight() / 192f);
        canvas.translate((bitmap.getWidth() - 360 * scale) / 2, (bitmap.getHeight() - 192 * scale) / 2);
        canvas.scale(scale, scale);

        LocalDate today = LocalDate.now(IST);
        JSONObject snapshot = readSnapshot(context);
        Map<String, JSONObject> rows = rows(snapshot);
        JSONObject row = rows.get(today.toString());
        boolean locked = context.getSharedPreferences("device", 0).getBoolean("appLock", false);
        String summary;
        text(canvas, paint, "drip", 20, 30, 17, LIME, true);
        right(canvas, paint, today.format(DateTimeFormatter.ofPattern("EEE d", INDIA)).toUpperCase(INDIA), 174, 29, 10, MUTED);
        if (locked || snapshot == null || row == null) {
            String title = locked ? "Figures hidden" : snapshot == null ? "Your daily drip" : "Time for a sync";
            text(canvas, paint, title, 20, 81, 23, WHITE, true);
            text(canvas, paint, locked ? "App lock is on" : "Open drip to update your budget", 20, 108, 12, MUTED, false);
            text(canvas, paint, locked ? "Tap to unlock drip" : "Tap to open drip", 20, 165, 12, LIME, false);
            drop(canvas, paint, 286, 57, 1, .45f, locked ? MUTED : LIME);
            summary = title + ". Tap to open drip.";
        } else {
            boolean budget = row.optBoolean("budget");
            long available = row.optLong("available");
            long spent = row.optLong("spent");
            long dayBudget = row.optLong("dayBudget");
            String amount = money(budget ? Math.abs(available) : spent);
            text(canvas, paint, budget ? available < 0 ? "Over budget by" : "Left today" : "Spent today", 20, 61, 12, MUTED, false);
            // Fit long Indian-grouped amounts instead of clipping them into the drop.
            float amountSize = 31;
            paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            paint.setTextSize(amountSize);
            while (paint.measureText(amount) > 112 && amountSize > 17) { amountSize--; paint.setTextSize(amountSize); }
            text(canvas, paint, amount, 20, 96, amountSize, budget && available < 0 ? CORAL : WHITE, true);
            text(canvas, paint, budget ? "of " + money(dayBudget) : "Tracking only", 20, 116, 11, MUTED, false);
            float fraction = !budget || dayBudget <= 0 ? 0 : Math.max(0, Math.min(1, available / (float) dayBudget));
            drop(canvas, paint, 133, 58, .75f, fraction, budget && available < 0 ? CORAL : LIME);
            text(canvas, paint, budget ? money(spent) + " spent today" : "No daily limit", 20, 145, 11, MUTED, false);
            String captured = snapshot.optString("capturedDate");
            boolean fresh = today.toString().equals(captured);
            String updated;
            try {
                java.time.ZonedDateTime at = java.time.Instant.ofEpochMilli(snapshot.optLong("updatedAt")).atZone(IST);
                updated = at.format(DateTimeFormatter.ofPattern(fresh ? "h:mm a" : "d MMM, h:mm a", INDIA));
            } catch (Exception e) { updated = "earlier"; }
            text(canvas, paint, fresh ? "Updated " + updated : "Estimate · open to sync", 20, 171, 10, MUTED, false);
            paint.setColor(Color.rgb(42, 42, 53));
            canvas.drawRect(188, 20, 189, 174, paint);
            long monthSpent = 0;
            int under = 0;
            for (Map.Entry<String, JSONObject> entry : rows.entrySet()) {
                String date = entry.getKey();
                if (!date.startsWith(today.toString().substring(0, 7)) || date.compareTo(today.toString()) > 0 || date.compareTo(captured) > 0) continue;
                monthSpent += entry.getValue().optLong("spent");
                if (budget && date.compareTo(today.toString()) < 0 && entry.getValue().optBoolean("budget") && entry.getValue().optBoolean("under")) under++;
            }
            text(canvas, paint, today.format(DateTimeFormatter.ofPattern("MMM", INDIA)).toUpperCase(INDIA), 203, 29, 11, WHITE, true);
            right(canvas, paint, budget ? under + " under" : "This month", 340, 29, 10, MUTED);
            calendar(canvas, paint, today, captured, rows);
            text(canvas, paint, "Month spent", 203, 180, 10, MUTED, false);
            right(canvas, paint, money(monthSpent), 340, 180, 11, WHITE);
            summary = (budget ? available < 0 ? "Over today's budget by " : "Left today " : "Spent today ") + amount
                    + ". " + (budget ? under + " completed days under budget. " : "Tracking only. ")
                    + "Month spent " + money(monthSpent) + ". Updated " + updated
                    + (fresh ? ". " : ". Estimated allowance; open to sync. ") + "Tap to open drip.";
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.drip_widget);
        views.setImageViewBitmap(R.id.widget_image, bitmap);
        views.setContentDescription(R.id.widget_image, summary);
        Intent open = new Intent(context, MainActivity.class).setAction("dev.paisapulse.app.WIDGET_OPEN")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_image, PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        manager.updateAppWidget(id, views);
    }

    private static void calendar(Canvas canvas, Paint paint, LocalDate today, String captured, Map<String, JSONObject> rows) {
        String[] days = {"M", "T", "W", "T", "F", "S", "S"};
        for (int i = 0; i < 7; i++) centered(canvas, paint, days[i], 212 + i * 20, 49, 10, MUTED);
        int offset = today.withDayOfMonth(1).getDayOfWeek().getValue() - 1;
        for (int day = 1; day <= today.lengthOfMonth(); day++) {
            LocalDate date = today.withDayOfMonth(day);
            int cell = offset + day - 1;
            float x = 203 + (cell % 7) * 20;
            float y = 56 + (cell / 7) * 17;
            JSONObject row = rows.get(date.toString());
            boolean observed = row != null && !date.isAfter(today) && date.toString().compareTo(captured) <= 0;
            int fill = Color.rgb(35, 35, 45), foreground = Color.rgb(121, 121, 140);
            if (observed) {
                fill = row.optBoolean("budget") ? row.optBoolean("under") ? Color.rgb(62, 78, 34) : Color.rgb(94, 46, 49) : Color.rgb(65, 52, 90);
                foreground = row.optBoolean("budget") ? row.optBoolean("under") ? Color.rgb(224, 255, 154) : Color.rgb(255, 202, 202) : Color.rgb(213, 192, 255);
            }
            if (date.equals(today)) { fill = LIME; foreground = PANEL; }
            paint.setColor(fill);
            canvas.drawRoundRect(new RectF(x, y, x + 17, y + 13), 3, 3, paint);
            centered(canvas, paint, String.valueOf(day), x + 8.5f, y + 10, 10, foreground);
        }
    }

    private static void drop(Canvas canvas, Paint paint, float x, float y, float scale, float fraction, int color) {
        canvas.save(); canvas.translate(x, y); canvas.scale(scale, scale);
        Path path = new Path();
        path.moveTo(32, 2); path.cubicTo(32, 2, 6, 32, 6, 49);
        path.cubicTo(6, 84, 58, 84, 58, 49); path.cubicTo(58, 32, 32, 2, 32, 2); path.close();
        paint.setColor(Color.rgb(48, 48, 58)); canvas.drawPath(path, paint);
        canvas.clipPath(path);
        paint.setColor(color);
        // Squared radius mapping makes the remaining liquid visible even near empty.
        float top = fraction >= 1 ? 0 : 77 * (1 - (float) Math.sqrt(Math.max(0, fraction)));
        if (fraction > 0) canvas.drawRect(0, top, 64, 80, paint);
        canvas.restore();
    }

    private static JSONObject readSnapshot(Context context) {
        try { return new JSONObject(context.getSharedPreferences("widget", 0).getString("snapshot", "")); }
        catch (Exception e) { return null; }
    }

    private static Map<String, JSONObject> rows(JSONObject snapshot) {
        Map<String, JSONObject> out = new HashMap<>();
        JSONArray rows = snapshot == null ? null : snapshot.optJSONArray("rows");
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null) out.put(row.optString("date"), row);
        }
        return out;
    }

    private static String money(long paise) {
        // Indian grouping isn't consistent across Android's NumberFormat implementations.
        String s = Long.toString(Math.abs(paise) / 100);
        if (s.length() > 3) {
            String tail = s.substring(s.length() - 3), head = s.substring(0, s.length() - 3);
            head = head.replaceAll("\\B(?=(\\d{2})+(?!\\d))", ",");
            s = head + "," + tail;
        }
        return "₹" + s;
    }

    private static void text(Canvas c, Paint p, String s, float x, float y, float size, int color, boolean medium) {
        p.setTextSize(size); p.setColor(color); p.setTypeface(Typeface.create(medium ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        p.setTextAlign(Paint.Align.LEFT); c.drawText(s, x, y, p);
    }

    private static void right(Canvas c, Paint p, String s, float x, float y, float size, int color) {
        p.setTextSize(size); p.setColor(color); p.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        p.setTextAlign(Paint.Align.RIGHT); c.drawText(s, x, y, p); p.setTextAlign(Paint.Align.LEFT);
    }

    private static void centered(Canvas c, Paint p, String s, float x, float y, float size, int color) {
        p.setTextSize(size); p.setColor(color); p.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        p.setTextAlign(Paint.Align.CENTER); c.drawText(s, x, y, p); p.setTextAlign(Paint.Align.LEFT);
    }
}
