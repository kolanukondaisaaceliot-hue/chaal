package com.stride.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** Single-activity WebView shell hosting the Chaal web app from local assets. */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNeededPermissions();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new NativeBridge(), "StrideNative");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/www/index.html");

        Intent svc = new Intent(this, StepService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc);
        else startService(svc);
    }

    private void requestNeededPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 29
                && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)
                        != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.ACTIVITY_RECOGNITION);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!perms.isEmpty()) requestPermissions(perms.toArray(new String[0]), 1001);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        super.onRequestPermissionsResult(code, p, r);
        if (Build.VERSION.SDK_INT >= 29
                && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)
                        != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this,
                    "Chaal needs the Activity Recognition permission to count steps.",
                    Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** JS bridge: window.StrideNative */
    class NativeBridge {
        @JavascriptInterface
        public int getSteps() {
            return StepService.getTodaySteps(MainActivity.this);
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // ---- Health Connect ----
        @JavascriptInterface
        public String getHealthStatus() {
            if (!HealthSync.isAvailable(MainActivity.this)) return "unavailable";
            if (!HealthSync.isEnabled(MainActivity.this)) return "disabled";
            return HealthSync.hasPermissions(MainActivity.this) ? "ready" : "needs_permission";
        }

        @JavascriptInterface
        public void setHealthSync(final boolean on) {
            HealthSync.setEnabled(MainActivity.this, on);
            if (on && HealthSync.isAvailable(MainActivity.this)) {
                if (!HealthSync.hasPermissions(MainActivity.this)) {
                    runOnUiThread(() -> {
                        try {
                            startActivityForResult(
                                    HealthSync.permissionIntent(MainActivity.this), 2001);
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this,
                                    "Could not open Health Connect permissions.",
                                    Toast.LENGTH_LONG).show();
                        }
                    });
                } else {
                    HealthSync.syncStepsNow(MainActivity.this);
                }
            }
        }

        @JavascriptInterface
        public void logWorkout(final String json) {
            HealthSync.writeWorkout(MainActivity.this, json);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 2001) {
            boolean ok = HealthSync.parsePermissionResult(resultCode, data);
            Toast.makeText(this,
                    ok ? "Health Connect connected ✓ — syncing steps & workouts."
                       : "Health Connect permission not granted.",
                    Toast.LENGTH_LONG).show();
            if (ok) HealthSync.syncStepsNow(this);
        }
    }
}
