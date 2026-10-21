package dev.paisapulse.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * `window.PaisaDevice` in the page (see src/data/device.ts): light haptics and
 * the fingerprint / screen-lock app lock. The lock setting lives here (not only
 * in the page) so the app can cover itself before any data is drawn.
 */
final class DeviceBridge {
    private final MainActivity activity;

    DeviceBridge(MainActivity activity) {
        this.activity = activity;
    }

    /** kind: "tap" (buttons), "success" (saved / done), "error". */
    @JavascriptInterface
    public void haptic(String kind) {
        activity.runOnUiThread(() -> activity.haptic(kind));
    }

    /** True if the phone has a fingerprint, PIN, pattern or password set up. */
    @JavascriptInterface
    public boolean canLock() {
        KeyguardManager km = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    @JavascriptInterface
    public boolean appLockEnabled() {
        return activity.lockEnabled();
    }

    /**
     * Turning the lock on asks for the fingerprint first, so it can't be enabled on a
     * phone where you can't unlock it. Fires `paisa-applock` either way.
     */
    @JavascriptInterface
    public void setAppLock(boolean on) {
        activity.runOnUiThread(() -> {
            if (!on) {
                activity.setLockEnabled(false);
                activity.emit("paisa-applock");
                return;
            }
            activity.authenticate(() -> {
                activity.setLockEnabled(true);
                activity.emit("paisa-applock");
            }, () -> activity.emit("paisa-applock"));
        });
    }
}
