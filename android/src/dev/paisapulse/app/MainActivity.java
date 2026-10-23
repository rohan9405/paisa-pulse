package dev.paisapulse.app;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
    // The page's origin is where WebView keeps its IndexedDB. Never change it (or the
    // package name): an update with a different origin would start with empty storage.
    static final String HOST = "paisapulse.local";
    static final int SMS_REQUEST = 1;
    static final int PICK_REQUEST = 2;
    static final int UNLOCK_REQUEST = 5;
    /** Back in the app within this long after leaving it: no need to unlock again. */
    private static final long RELOCK_AFTER_MS = 60_000;
    private WebView web;
    private FilesBridge files;
    private ValueCallback<Uri[]> pickCallback;
    private TextView lockCover;
    private boolean unlocked;
    private boolean authenticating;
    private long stoppedAt;
    private Runnable unlockOk, unlockFail;

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
        files = new FilesBridge(this);
        web.addJavascriptInterface(files, "PaisaFiles");
        web.addJavascriptInterface(new DeviceBridge(this), "PaisaDevice");
        web.addJavascriptInterface(new WidgetBridge(this), "PaisaWidget");
        // Needed for <input type=file> (CSV import, backup restore) and confirm() dialogs.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pickCallback != null) pickCallback.onReceiveValue(null);
                pickCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_REQUEST);
                } catch (Exception e) {
                    pickCallback = null;
                    return false;
                }
                return true;
            }
        });
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
        // App lock: a cover over the page until the fingerprint / screen lock is confirmed.
        lockCover = new TextView(this);
        lockCover.setText("🔒\n\nDrip is locked\nTap to unlock");
        lockCover.setGravity(Gravity.CENTER);
        lockCover.setTextColor(0xffe8e8ef);
        lockCover.setTextSize(18);
        lockCover.setTypeface(Typeface.DEFAULT_BOLD);
        lockCover.setBackgroundColor(0xff07070a);
        lockCover.setOnClickListener(v -> unlock());
        lockCover.setVisibility(lockEnabled() ? View.VISIBLE : View.GONE);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        root.addView(lockCover);
        setContentView(root);
        if (saved != null && !"dev.paisapulse.app.WIDGET_OPEN".equals(getIntent().getAction())) web.restoreState(saved);
        else web.loadUrl("https://" + HOST + widgetRoute(getIntent()));

        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS}, SMS_REQUEST);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if ("dev.paisapulse.app.WIDGET_OPEN".equals(intent.getAction())) web.loadUrl("https://" + HOST + widgetRoute(intent));
    }

    private static String widgetRoute(Intent intent) {
        String route = intent.getStringExtra("widgetRoute");
        return route != null && (route.equals("/dashboard/") || route.equals("/briefing/") || route.matches("/briefing/\\?day=\\d{4}-\\d{2}-\\d{2}")) ? route : "/";
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

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (code == PICK_REQUEST && pickCallback != null) {
            pickCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pickCallback = null;
        } else if (code == FilesBridge.SAVE_REQUEST) {
            files.onSaveResult(uri);
        } else if (code == FilesBridge.FOLDER_REQUEST) {
            files.onFolderResult(uri);
        } else if (code == UNLOCK_REQUEST) {
            finishAuth(result == RESULT_OK);
        }
    }

    void emit(String event) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
        });
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
        if (lockEnabled() && !unlocked) unlock();
    }

    @Override
    protected void onPause() {
        web.onPause();
        // Hide amounts in the recent-apps preview while locked.
        if (lockEnabled() && !authenticating) lockCover.setVisibility(View.VISIBLE);
        super.onPause();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt > RELOCK_AFTER_MS) unlocked = false;
        if (unlocked) lockCover.setVisibility(View.GONE);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (!authenticating) stoppedAt = SystemClock.elapsedRealtime();
    }

    // ---- app lock & haptics (see DeviceBridge)

    boolean lockEnabled() {
        return getSharedPreferences("device", 0).getBoolean("appLock", false);
    }

    void setLockEnabled(boolean on) {
        getSharedPreferences("device", 0).edit().putBoolean("appLock", on).apply();
        DripWidgetProvider.refresh(this);
        unlocked = true;
        lockCover.setVisibility(View.GONE);
    }

    private void unlock() {
        if (authenticating) return;
        authenticate(() -> {
            unlocked = true;
            lockCover.setVisibility(View.GONE);
        }, () -> lockCover.setVisibility(View.VISIBLE));
    }

    /** Fingerprint, face or the phone's PIN / pattern / password. */
    void authenticate(Runnable ok, Runnable fail) {
        if (authenticating) return;
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) {
            fail.run();
            return;
        }
        authenticating = true;
        unlockOk = ok;
        unlockFail = fail;
        if (Build.VERSION.SDK_INT >= 28) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(this).setTitle("Unlock drip").setSubtitle("Use your fingerprint or screen lock");
            if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            else b.setDeviceCredentialAllowed(true);
            b.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    finishAuth(true);
                }

                @Override
                public void onAuthenticationError(int code, CharSequence message) {
                    finishAuth(false);
                }
            });
        } else {
            Intent i = km.createConfirmDeviceCredentialIntent("Unlock drip", null);
            if (i == null) finishAuth(true);
            else startActivityForResult(i, UNLOCK_REQUEST);
        }
    }

    private void finishAuth(boolean ok) {
        authenticating = false;
        Runnable r = ok ? unlockOk : unlockFail;
        unlockOk = unlockFail = null;
        if (r != null) r.run();
    }

    void haptic(String kind) {
        int c = HapticFeedbackConstants.KEYBOARD_TAP;
        if ("success".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
        else if ("error".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
        web.performHapticFeedback(c);
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
