package com.reflexityram.admin;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The shop's admin panel in a full-screen web view, already signed in. The sign-in comes from the device token this phone
 * was paired with (never a password): the app asks the server for a 24 h admin session and puts it where the site expects
 * its login, so the admin pages simply open. Unpaired, it shows a box for the one-time code from Admin > Security.
 */
public final class MainActivity extends Activity {
    private static final int REQ_FILE = 11;
    private static final int REQ_NOTIFICATIONS = 12;
    // Light by default, dark when the phone is: the web view reports the app theme as prefers-color-scheme.
    private static final String ERROR_HTML = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'><meta name='color-scheme' content='light dark'>"
            + "<style>body{background:#fafaf7;color:#17181a;font-family:sans-serif;padding:32px}p.m{color:#55585e}a{color:#8a5a00;font-size:18px}"
            + "@media (prefers-color-scheme:dark){body{background:#08090a;color:#f2f2ee}p.m{color:#a6a8ad}a{color:#ffcf24}}</style></head><body>"
            + "<h2>Can't reach the shop</h2><p class='m'>Check the connection, then</p>"
            + "<p><a href='rfx://retry'>Try again</a></p></body></html>";

    private final ExecutorService background = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Store store;
    private FrameLayout root;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingPath = Config.HOME_PATH;
    private boolean tokenPlanted = false;
    /** Set when the admin page is loaded right after the sign-in page, so the sign-in page can be dropped from the history once it has loaded. */
    private boolean clearHistoryNext = false;
    private int nightMode;
    private String restorePath;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        if (savedInstanceState != null) restorePath = savedInstanceState.getString("rfx_path");
        store = new Store(this);
        Notifier.createChannels(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.bg));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::goBackOrExit;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        route(getIntent());
    }

    /** The phone switched between light and dark: the colours come from resources and the site's theme is planted from them, so start over on the same page. */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if ((newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) != nightMode) recreate();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        String url = web == null ? null : web.getUrl();
        if (url != null && url.startsWith(Config.SITE)) outState.putString("rfx_path", url.substring(Config.SITE.length()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        route(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!store.isPaired()) return;
        EventService.start(this);
        askForNotifications();
        renewSessionIfNeeded();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        background.shutdownNow();
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBackOrExit();
    }

    /**
     * Back closes whatever the page has open on top (an order, a product), else goes back in the page, else leaves the app. The page
     * answers through window.rfxHandleBack (frontend/src/lib/appBridge.js); an older page without it simply answers nothing.
     */
    private void goBackOrExit() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(function(){return !!(window.rfxHandleBack && window.rfxHandleBack());})()", result -> {
            if ("true".equals(result)) return;
            if (web != null && web.canGoBack()) web.goBack(); else finish();
        });
    }

    // ── what the app was asked to do ──────────────────────────────────────────
    private void route(Intent intent) {
        String code = intent == null ? null : intent.getStringExtra("pair_code");
        if (!store.isPaired()) {
            // The one-time code can arrive with the install (adb) while the phone is still unpaired; once paired it is ignored.
            if (code != null && !code.isEmpty()) pairWith(code); else showPairing(null);
            return;
        }
        Uri data = intent == null ? null : intent.getData();
        String path = Config.HOME_PATH;
        if (data != null && isSite(data) && data.getEncodedPath() != null && data.getEncodedPath().startsWith("/admin")) {
            path = data.getEncodedPath() + (data.getEncodedQuery() != null ? "?" + data.getEncodedQuery() : "");
        } else if (restorePath != null && restorePath.startsWith("/")) {
            path = restorePath;
        }
        restorePath = null;
        showAdmin(path);
    }

    // ── pairing ───────────────────────────────────────────────────────────────
    private void showPairing(String message) {
        root.removeAllViews();
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(28);
        column.setPadding(pad, dp(72), pad, pad);

        column.addView(text("Reflexity Admin", 26, getColor(R.color.text), true));
        column.addView(text("Open Admin > Security > Phone app on the website, press \"Pair a phone\" and type the code here.", 15, getColor(R.color.muted), false), spaced(dp(12)));

        EditText input = new EditText(this);
        input.setHint("ABCD-EFGH");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setTextSize(24);
        input.setTextColor(getColor(R.color.text));
        input.setHintTextColor(getColor(R.color.hint));
        input.setGravity(Gravity.CENTER);
        input.setLetterSpacing(0.15f);
        column.addView(input, spaced(dp(28)));

        TextView status = text(message == null ? "" : message, 14, getColor(R.color.error), false);
        Button pair = new Button(this);
        pair.setText("Pair this phone");
        pair.setBackgroundColor(getColor(R.color.brand));
        pair.setTextColor(getColor(R.color.ink));
        pair.setOnClickListener(v -> {
            String code = input.getText().toString().trim();
            if (code.length() < 8) { status.setText("Type the 8-character code."); return; }
            pair.setEnabled(false);
            status.setTextColor(getColor(R.color.muted));
            status.setText("Pairing…");
            background.execute(() -> {
                String error = doPair(code);
                ui.post(() -> {
                    if (error == null) { onPaired(); return; }
                    pair.setEnabled(true);
                    status.setTextColor(getColor(R.color.error));
                    status.setText(error);
                });
            });
        });
        column.addView(pair, spaced(dp(20)));
        column.addView(status, spaced(dp(14)));
        root.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Pairs with a code that came in with the launch. */
    private void pairWith(String code) {
        showPairing("Pairing…");
        background.execute(() -> {
            String error = doPair(code);
            ui.post(() -> {
                if (error == null) onPaired(); else showPairing(error);
            });
        });
    }

    /** Returns null on success, or a message for the owner. */
    private String doPair(String code) {
        try {
            JSONObject answer = Api.pair(code, Build.MODEL == null ? "Android phone" : Build.MODEL);
            store.saveDeviceToken(answer.getString("token"));
            store.saveCursor(null);
            return null;
        } catch (Api.ApiException e) {
            return e.status == 400 || e.status == 409 || e.status == 429 ? e.getMessage() : "The shop said: " + e.getMessage();
        } catch (Exception e) {
            return "Could not reach the shop. Check the connection and try again.";
        }
    }

    private void onPaired() {
        EventService.start(this);
        askForNotifications();
        showAdmin(Config.HOME_PATH);
    }

    // ── the admin panel ───────────────────────────────────────────────────────
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void ensureWebView() {
        if (web != null) return;
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        // Lets the page know it is inside the app (frontend/src/lib/appBridge.js: isAdminApp), e.g. to leave out "Sign out".
        settings.setUserAgentString(settings.getUserAgentString() + " ReflexityAdminApp/" + Config.APP_VERSION);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("rfx".equals(uri.getScheme())) { showAdmin(pendingPath); return true; }
                if (isSite(uri)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { /* nothing can open it */ }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url == null) return;
                if (url.equals(Config.BRIDGE_PAGE)) {
                    // Same origin as the admin site: plant the session, then open the page that was asked for.
                    plantToken(() -> { clearHistoryNext = true; view.loadUrl(Config.SITE + pendingPath); });
                } else if (url.startsWith(Config.SITE)) {
                    // The sign-in page is not a place to go back to: once the real page is up, Back at its top leaves the app.
                    if (clearHistoryNext) { clearHistoryNext = false; view.clearHistory(); }
                    // The site signed itself out (its own "Sign out" button): sign back in and reload.
                    view.evaluateJavascript("(function(){return localStorage.getItem('rfx_token') ? 'ok' : 'missing';})()", result -> {
                        if (result != null && result.contains("missing") && store.sessionJwt() != null) plantToken(view::reload);
                    });
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadDataWithBaseURL(null, ERROR_HTML, "text/html", "utf-8", null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // A web view shows no alert, confirm or prompt box unless the app does it: without these, window.confirm() answers "no" and a
            // button that asks first does nothing. Only the shop's own pages may ask.
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (!askableUrl(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!askableUrl(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                if (!askableUrl(url)) { result.cancel(); return true; }
                EditText field = new EditText(MainActivity.this);
                field.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(field)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm(field.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });
    }

    private void showAdmin(String path) {
        pendingPath = path;
        ensureWebView();
        if (web.getParent() != root) {
            root.removeAllViews();
            root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        background.execute(() -> {
            String problem = ensureSession(false);
            ui.post(() -> {
                if (problem != null) { showPairing(problem); return; }
                if (tokenPlanted && web.getUrl() != null && web.getUrl().startsWith(Config.SITE)) web.loadUrl(Config.SITE + pendingPath);
                else web.loadUrl(Config.BRIDGE_PAGE);
            });
        });
    }

    /**
     * Makes sure there is a usable admin session. Returns null when there is, or a message when the phone has to be paired
     * again (it was removed on the Security page, or the admin's password changed).
     */
    private String ensureSession(boolean forceNew) {
        long now = System.currentTimeMillis();
        boolean fresh = store.sessionJwt() != null && store.sessionValidUntilMs() - now > Config.SESSION_RENEW_BEFORE_MS;
        if (fresh && !forceNew) return null;
        String token = store.deviceToken();
        if (token == null) return store.hasSavedToken() ? "The saved pairing could not be read yet. Try again in a moment." : "Pair this phone to continue.";
        try {
            JSONObject answer = Api.session(token);
            store.saveSession(answer.getString("accessToken"), now + answer.optLong("expiresInSeconds", 86_400) * 1000);
            return null;
        } catch (Api.ApiException e) {
            if (e.revoked()) {
                store.forgetDevice();
                stopService(new Intent(this, EventService.class));
                return "This phone was removed or signed out. Pair it again.";
            }
        } catch (Exception ignored) {
            // offline: fall through and use what we have
        }
        // Could not renew: a session that has not expired yet is still good enough.
        return store.sessionJwt() != null && store.sessionValidUntilMs() > now ? null : "Could not reach the shop to sign in. Check the connection.";
    }

    private void renewSessionIfNeeded() {
        if (web == null || !tokenPlanted) return;
        background.execute(() -> {
            if (ensureSession(false) == null) ui.post(() -> plantToken(null));
        });
    }

    /** Puts the admin session where the site's own login keeps it (localStorage "rfx_token"). Must run on a page of the site. */
    private void plantToken(Runnable then) {
        String jwt = store.sessionJwt();
        if (jwt == null || web == null) { if (then != null) then.run(); return; }
        // The site's own theme setting follows the phone (light or dark), so the page, the status bar and every dialog agree.
        String theme = isNight() ? "dark" : "light";
        String js = "(function(){try{localStorage.setItem('rfx_token'," + JSONObject.quote(jwt) + ");localStorage.removeItem('rfx-auth');"
                + "localStorage.setItem('reflexity-theme',JSON.stringify({state:{theme:'" + theme + "'},version:0}));return 'ok';}catch(e){return 'blocked';}})()";
        web.evaluateJavascript(js, result -> {
            tokenPlanted = result != null && result.contains("ok");
            if (then != null) then.run();
        });
    }

    // ── permissions ───────────────────────────────────────────────────────────
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
            return;
        }
        // Alerts have to arrive with the screen off, so ask once to be left out of battery optimization.
        PowerManager power = getSystemService(PowerManager.class);
        android.content.SharedPreferences asked = getSharedPreferences("rfx_ui", MODE_PRIVATE);
        if (!power.isIgnoringBatteryOptimizations(getPackageName()) && !asked.getBoolean("battery_asked", false)) {
            asked.edit().putBoolean("battery_asked", true).apply();
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException ignored) { /* not offered on this phone */ }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS) askForNotifications();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private static boolean askableUrl(String url) {
        return url != null && isSite(Uri.parse(url));
    }

    /** True for the shop's own pages (same scheme, host and port as Config.SITE, with or without "www."): the only ones the web view may show. */
    private static boolean isSite(Uri uri) {
        Uri site = Uri.parse(Config.SITE);
        String host = uri.getHost();
        if (host == null || site.getScheme() == null || !site.getScheme().equals(uri.getScheme())) return false;
        if (site.getPort() != -1 && site.getPort() != uri.getPort()) return false;
        return host.equals(site.getHost()) || host.equals("www." + site.getHost());
    }

    // ── small view helpers ────────────────────────────────────────────────────
    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private LinearLayout.LayoutParams spaced(int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = top;
        return params;
    }
}
