package app.passengercount;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;

/** Runs production ExportStorage against host files and simulated providers. */
public class ExportStorageTest {
    private static int assertions = 0;
    private static byte[] data(String text) { return text.getBytes(StandardCharsets.UTF_8); }
    private static void check(boolean value, String message) {
        assertions++;
        if (!value) throw new AssertionError(message);
    }
    private static Context context() throws IOException {
        Environment.root = Files.createTempDirectory("storage-test-").toFile();
        return new Context();
    }
    private static String saveBundle(ExportStorage storage, String folder, boolean png) throws IOException {
        return storage.saveBundle(folder, folder, data("csv"), data("json"), data("gpx"), png ? data("png") : new byte[0]);
    }

    private static void bundleControls() throws Exception {
        for (int api : new int[]{26, 28, 29, 35}) {
            Build.VERSION.SDK_INT = api;
            Context context = context();
            ExportStorage storage = new ExportStorage(context);
            String path = saveBundle(storage, "trip", true);
            check(path.endsWith("/Download/PaxCountRecord/trip"), "bundle path");
            if (api < 29) {
                File directory = new File(path);
                check(directory.list().length == 4, "four physical companions");
                check(Arrays.equals(Files.readAllBytes(new File(directory, "trip.json").toPath()), data("json")), "JSON bytes");
                try {
                    saveBundle(storage, "trip", true);
                    throw new AssertionError("collision accepted");
                } catch (IOException expected) {}
                check(Arrays.equals(Files.readAllBytes(new File(directory, "trip.csv").toPath()), data("csv")), "collision cannot overwrite");
            } else {
                check(context.resolver.bytes.size() == 4, "four MediaStore companions");
                for (ContentValues values : context.resolver.entries.values())
                    check(Integer.valueOf(0).equals(values.get("pending")), "published row");
            }
        }
        for (boolean tree : new boolean[]{false, true}) {
            Build.VERSION.SDK_INT = 29;
            Context context = context();
            ExportStorage storage = new ExportStorage(context);
            if (tree) storage.setTree("content://tree/root");
            saveBundle(storage, "optional", false);
            check(context.resolver.bytes.size() == 3, "optional PNG omitted");
        }
        for (boolean tree : new boolean[]{false, true}) {
            for (int fail = 1; fail <= 4; fail++) {
                Build.VERSION.SDK_INT = 29;
                Context context = context();
                ExportStorage storage = new ExportStorage(context);
                if (tree) storage.setTree("content://tree/root");
                context.resolver.failOpen = fail;
                try {
                    saveBundle(storage, "failure", true);
                    throw new AssertionError("open failure missing");
                } catch (IOException expected) {}
                check(context.resolver.entries.isEmpty(), "cleanup after open failure " + tree + " " + fail);
                check(context.resolver.bytes.isEmpty(), "byte cleanup");
            }
        }
        for (int fail = 1; fail <= 4; fail++) {
            Build.VERSION.SDK_INT = 29;
            Context context = context();
            ExportStorage storage = new ExportStorage(context);
            context.resolver.failPublish = fail;
            try {
                saveBundle(storage, "publish", true);
                throw new AssertionError("publish failure missing");
            } catch (IOException expected) {}
            check(context.resolver.entries.isEmpty(), "cleanup on publish failure");
        }
    }

    private static void standaloneMetadataControls() throws Exception {
        String[][] formats = {{"csv", "text/csv"}, {"gpx", "application/gpx+xml"}, {"png", "image/png"}};
        String[] metadataModes = {"none", "query", "move", "name", "relative", "close",
            "null-cursor", "empty-cursor", "null-name", "null-relative"};
        for (int api : new int[]{29, 35}) {
            Build.VERSION.SDK_INT = api;
            for (String[] format : formats) {
                for (String mode : metadataModes) {
                    Context context = context();
                    context.resolver.metadataFailure = mode;
                    String filename = "trip." + format[0];
                    byte[] bytes = data("saved " + format[0]);
                    String result = new ExportStorage(context).save(bytes, filename, format[1]);
                    Uri uri = Uri.parse("content://provider/1");
                    String expected = mode.equals("none")
                        ? new File(Environment.root, "Download/PaxCountRecord/" + filename).getAbsolutePath()
                        : uri.toString();
                    check(result.equals(expected), "successful publication result for API " + api + ": " + format[0] + "/" + mode);
                    check(context.resolver.entries.size() == 1, "exactly one public row");
                    check(context.resolver.bytes.size() == 1, "exactly one saved file");
                    check(Arrays.equals(context.resolver.bytes.get(uri), bytes), "saved bytes unchanged");
                    check(Integer.valueOf(0).equals(context.resolver.entries.get(uri).get("pending")), "file published");
                    check(context.resolver.queries == 1 && context.resolver.publishes == 1, "one publication before optional metadata query");
                    check(context.resolver.deletes == 0, "metadata failure does not delete successful output");
                }
                for (boolean failPublish : new boolean[]{false, true}) {
                    Context context = context();
                    if (failPublish) context.resolver.failPublish = 1;
                    else context.resolver.failOpen = 1;
                    try {
                        new ExportStorage(context).save(data("rejected write"), "trip." + format[0], format[1]);
                        throw new AssertionError("write/publication failure was treated as metadata success");
                    } catch (IOException expected) {}
                    check(context.resolver.entries.isEmpty() && context.resolver.bytes.isEmpty(), "prepublication failure rolls back output");
                    check(context.resolver.queries == 0, "prepublication failure never resolves display metadata");
                }
            }
        }
    }

    public static void main(String[] args) throws Exception {
        bundleControls();
        standaloneMetadataControls();
        System.out.println("ExportStorage: " + assertions + " assertions passed (production writer, host files and simulated providers; no installed-device claim)");
    }
}
