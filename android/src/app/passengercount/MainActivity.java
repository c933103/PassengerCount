package app.passengercount;

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
    private static final int LOCATION = 10, EXPORT_DIRECTORY = 11, LEGACY_STORAGE = 12;
    private final java.util.concurrent.ExecutorService exports = java.util.concurrent.Executors.newSingleThreadExecutor();
    private Runnable pendingLegacyExport;
    private boolean choosingDirectory;
    private WebView web;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
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
                        + "connect-src 'self' https://static.data.gov.hk https://data.weather.gov.hk "
                        + "https://www.1823.gov.hk https://data.etabus.gov.hk https://rt.data.gov.hk "
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
            connection.setRequestProperty("User-Agent", "PassengerCount/1.9");
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
        if (code == LEGACY_STORAGE && pendingLegacyExport != null) {
            Runnable task = pendingLegacyExport;
            pendingLegacyExport = null;
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
                exports.execute(task);
            else exportResult(false, "");
        }
        if (code == LOCATION && locationCallback != null) {
            locationCallback.invoke(locationOrigin, hasLocation(), false);
            locationCallback = null;
            if (hasLocation()) startPendingTrack();
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
        @JavascriptInterface public void setLanguage(String language) {
            if ("en".equals(language) || "yue-Hant-HK".equals(language))
                prefs.edit().putString("language", language).commit();
        }
        @JavascriptInterface public void saveCsv(String content, String filename) {
            queueExport(() -> {
                try {
                    if (content == null || content.length() > 10_000_000 || !filename.endsWith(".csv"))
                        throw new IOException("Invalid CSV");
                    exportResult(true, new ExportStorage(MainActivity.this).save(content.getBytes(StandardCharsets.UTF_8), filename, "text/csv"));
                } catch (Exception e) { exportResult(false, ""); }
            });
        }
        @JavascriptInterface public void saveGpx(String content, String filename) {
            queueExport(() -> {
                try {
                    if (content == null || content.length() > 20_000_000 || !filename.endsWith(".gpx")
                            || !content.startsWith("<?xml"))
                        throw new IOException("Invalid GPX");
                    exportResult(true, new ExportStorage(MainActivity.this).save(
                        content.getBytes(StandardCharsets.UTF_8), filename, "application/gpx+xml"));
                } catch (Exception e) { exportResult(false, ""); }
            });
        }
        @JavascriptInterface public void savePng(String base64, String filename) {
            queueExport(() -> {
                try {
                    if (base64 == null || base64.length() > 20_000_000 || !filename.endsWith(".png"))
                        throw new IOException("Invalid image");
                    byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                    byte[] signature = {(byte)137, 80, 78, 71, 13, 10, 26, 10};
                    if (bytes.length < signature.length) throw new IOException("Invalid PNG");
                    for (int i = 0; i < signature.length; i++)
                        if (bytes[i] != signature[i]) throw new IOException("Invalid PNG");
                    exportResult(true, new ExportStorage(MainActivity.this).save(bytes, filename, "image/png"));
                } catch (Exception e) { exportResult(false, ""); }
            });
        }
        @JavascriptInterface public String getExportDirectory() { return new ExportStorage(MainActivity.this).directory(); }
        @JavascriptInterface public String getExportResult() { return getSharedPreferences("exports", MODE_PRIVATE).getString("result", null); }
        @JavascriptInterface public void chooseExportDirectory() { runOnUiThread(() -> chooseDirectory()); }
        @JavascriptInterface public void resetExportDirectory() { runOnUiThread(() -> storeDirectory(null)); }
        @JavascriptInterface public void startTracking(String surveyId) {
            String id = TrackService.safeId(surveyId);
            if (id.isEmpty()) return;
            getSharedPreferences("tracking", MODE_PRIVATE).edit().putString("pending_id", id).commit();
            runOnUiThread(() -> startPendingTrack());
        }
        @JavascriptInterface public void stopTracking(String surveyId) {
            String id = TrackService.safeId(surveyId);
            runOnUiThread(() -> {
                SharedPreferences tracking = getSharedPreferences("tracking", MODE_PRIVATE);
                if (id.equals(tracking.getString("pending_id", ""))) tracking.edit().remove("pending_id").commit();
                Intent stop = new Intent(MainActivity.this, TrackService.class).setAction(TrackService.ACTION_STOP);
                stopService(stop);
            });
        }
        @JavascriptInterface public String getTrack(String surveyId) {
            String id = TrackService.safeId(surveyId);
            org.json.JSONArray points = new org.json.JSONArray();
            if (id.isEmpty()) return points.toString();
            File file = TrackService.trackFile(MainActivity.this, id);
            if (!file.isFile()) return points.toString();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    new FileInputStream(file), StandardCharsets.UTF_8))) {
                String line;
                int count = 0;
                while ((line = reader.readLine()) != null && count++ < 20000) {
                    try { points.put(new org.json.JSONObject(line)); }
                    catch (org.json.JSONException ignored) {}
                }
            } catch (IOException ignored) {}
            return points.toString();
        }
    }
    private void startPendingTrack() {
        String id = getSharedPreferences("tracking", MODE_PRIVATE).getString("pending_id", "");
        if (id.isEmpty() || !hasLocation()) return;
        Intent intent = new Intent(this, TrackService.class)
            .setAction(TrackService.ACTION_START)
            .putExtra(TrackService.EXTRA_ID, id);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
    }
    private void queueExport(Runnable task) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < 29 && new ExportStorage(this).tree() == null &&
                    checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                if (pendingLegacyExport != null) { exportResult(false, ""); return; }
                pendingLegacyExport = task;
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, LEGACY_STORAGE);
            } else exports.execute(task);
        });
    }
    private void exportResult(boolean ok, String path) {
        try {
            org.json.JSONObject result = new org.json.JSONObject();
            result.put("ok", ok); result.put("path", path);
            String json = result.toString();
            getSharedPreferences("exports", MODE_PRIVATE).edit().putString("result", json).commit();
            emit("export-result", json);
        } catch (org.json.JSONException ignored) {}
    }
    private void emit(String event, String json) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent(" +
                org.json.JSONObject.quote(event) + ",{detail:" + json + "}));", null);
        });
    }
    private void chooseDirectory() {
        if (choosingDirectory) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String tree = new ExportStorage(this).tree();
        Uri initial = tree == null
            ? android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Download/PaxCountRecord")
            : Uri.parse(tree);
        intent.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, initial);
        try { startActivityForResult(intent, EXPORT_DIRECTORY); choosingDirectory = true; }
        catch (android.content.ActivityNotFoundException e) { toast("Cannot open folder picker."); }
    }
    private boolean storeDirectory(String tree) {
        ExportStorage storage = new ExportStorage(this);
        String old = storage.tree();
        if (!storage.setTree(tree)) { toast("Cannot save export folder."); return false; }
        if (old != null && !old.equals(tree)) {
            try { getContentResolver().releasePersistableUriPermission(Uri.parse(old),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            catch (SecurityException ignored) {}
        }
        emit("export-directory-changed", "null");
        return true;
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != EXPORT_DIRECTORY) return;
        choosingDirectory = false;
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri tree = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            if ((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) throw new SecurityException("No write permission");
            getContentResolver().takePersistableUriPermission(tree, flags);
            if (!storeDirectory(tree.toString())) getContentResolver().releasePersistableUriPermission(tree, flags);
        } catch (SecurityException e) { toast("Cannot save export folder."); }
    }
    private void toast(String message) {
        if (!"en".equals(getSharedPreferences("surveys", MODE_PRIVATE).getString("language", "yue-Hant-HK"))) {
            switch (message) {
                case "No browser available.": message = "未有可用的瀏覽器。"; break;
                case "Cannot open folder picker.": message = "未能開啟資料夾選擇器。"; break;
                case "Cannot save export folder.": message = "未能儲存匯出資料夾設定，原有設定已保留。"; break;
            }
        }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        if (web != null) { web.removeJavascriptInterface("PassengerCountAndroid"); web.destroy(); }
        web = null;
        exports.shutdown();
        super.onDestroy();
    }
}
