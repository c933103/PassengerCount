package io.github.c933103.passengercount;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.*;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** An offline app shell. Only packaged, trusted content can access the bridge. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int LOCATION = 10, EXPORT = 11;
    private WebView web;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state == null) pendingExport().delete();
        createWebView();
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(240, 244, 243));
        setContentView(web);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PassengerCount/1.1");
        web.addJavascriptInterface(new DeviceStorage(), "PassengerCountAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!trusted(uri)) return null;
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..") || !request.getMethod().equals("GET")) return missing();
                if (path.equals("/government/en.zip") || path.equals("/government/zh.zip")) {
                    return governmentArchive(path.endsWith("en.zip") ? "en" : "tc");
                }
                try {
                    InputStream body = getAssets().open("www" + path);
                    String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css"
                        : path.endsWith(".json") ? "application/json" : path.endsWith(".png") ? "image/png"
                        : path.endsWith(".html") ? "text/html" : "application/octet-stream";
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; "
                        + "connect-src 'self' https://static.data.gov.hk "
                        + "https://jirzkyvwfpbblvyivikw.supabase.co; frame-src 'none'; object-src 'none'; "
                        + "base-uri 'none'; form-action 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, body);
                } catch (IOException e) { return missing(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                // Never load third-party documents in a view that has the native bridge.
                if (request.isForMainFrame() && request.hasGesture()
                    && "https".equals(request.getUrl().getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (android.content.ActivityNotFoundException e) { toast("No browser available."); }
                }
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                view.destroy();
                createWebView(); // Each edit is already committed to device storage.
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!trusted(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
                locationCallback = callback;
                locationOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION);
            }
        });
        web.loadUrl(ORIGIN + "/index.html");
    }

    // Only two fixed government archives are proxied; this is not an arbitrary URL fetcher.
    // The government file host omits CORS headers, so WebView requests use our own origin.
    private WebResourceResponse governmentArchive(String language) {
        try {
            java.net.URL url = new java.net.URL("https://static.data.gov.hk/td/pt-headway-" + language + "/gtfs.zip");
            final javax.net.ssl.HttpsURLConnection connection = (javax.net.ssl.HttpsURLConnection) url.openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "PassengerCount/1.1");
            if (connection.getResponseCode() != 200) { connection.disconnect(); return missing(); }
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            String modified = connection.getHeaderField("Last-Modified");
            if (modified != null) headers.put("Last-Modified", modified);
            InputStream stream = new FilterInputStream(connection.getInputStream()) {
                @Override public void close() throws IOException { try { super.close(); } finally { connection.disconnect(); } }
            };
            return new WebResourceResponse("application/zip", null, 200, "OK", headers, stream);
        } catch (IOException e) { return missing(); }
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<>(),
            new ByteArrayInputStream(new byte[0]));
    }
    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == LOCATION && locationCallback != null) {
            locationCallback.invoke(locationOrigin, hasLocation(), false);
            locationCallback = null;
        }
    }

    public final class DeviceStorage {
        private final SharedPreferences prefs = getSharedPreferences("surveys", MODE_PRIVATE);
        private boolean allowed(String key) {
            return "passenger-count:workspace:v2".equals(key) || "passenger-count:surveyor".equals(key);
        }
        @JavascriptInterface public String get(String key) { return allowed(key) ? prefs.getString(key, null) : null; }
        @JavascriptInterface public boolean set(String key, String value) {
            // commit(), not apply(): the next JS event only runs after this edit reaches disk.
            return allowed(key) && value != null && prefs.edit().putString(key, value).commit();
        }
        @JavascriptInterface public void saveCsv(String content, String filename) {
            runOnUiThread(() -> exportCsv(content, filename));
        }
    }

    private File pendingExport() { return new File(getFilesDir(), "pending-export.csv"); }
    private void exportCsv(String content, String filename) {
        if (pendingExport().exists()) { toast("Finish or cancel the current export first."); return; }
        try {
            try (FileOutputStream output = new FileOutputStream(pendingExport())) {
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("text/csv");
            intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[^a-zA-Z0-9._-]", "_"));
            startActivityForResult(intent, EXPORT);
        } catch (IOException | android.content.ActivityNotFoundException e) {
            pendingExport().delete();
            toast("Cannot open the file picker. Your survey is still saved in the app.");
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != EXPORT) return;
        try {
            if (result == RESULT_OK && data != null && data.getData() != null) {
                try (InputStream input = new FileInputStream(pendingExport());
                     OutputStream output = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (output == null) throw new IOException("No output stream");
                    byte[] buffer = new byte[8192]; int n;
                    while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
                }
                toast("CSV saved.");
            }
        } catch (IOException e) { toast("CSV could not be saved. Your survey is still in the app; try again."); }
        finally { pendingExport().delete(); }
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        if (web != null) { web.removeJavascriptInterface("PassengerCountAndroid"); web.destroy(); }
        super.onDestroy();
    }
}
