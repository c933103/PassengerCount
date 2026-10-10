from pathlib import Path
root=Path('.');fixture=(root/'tests/native/ExportPermissionFixture.java').read_text()
marker='        System.out.println(assertions + " assertions; " + failures + " failing scenarios");'
extra=r'''
        for (boolean treeDestination : new boolean[]{false, true}) for (String cleanupMode : new String[]{"confirmed", "zero", "throw"})
            for (boolean failedCommit : new boolean[]{false, true}) for (boolean recreate : new boolean[]{false, true}) {
                scenario("JOINED writer/lifecycle tree=" + treeDestination + " cleanup=" + cleanupMode + " commitFailure=" + failedCommit + " recreate=" + recreate, () -> {
                    Build.VERSION.SDK_INT = 35; android.os.Build.VERSION.SDK_INT = 35;
                    android.os.Environment.root = java.nio.file.Files.createTempDirectory("joined-rollback-").toFile();
                    android.content.Context provider = new android.content.Context();
                    if (treeDestination) provider.prefs.edit().putString("tree", "content://tree/root").commit();
                    provider.resolver.failOpen = 3;
                    provider.resolver.zeroDelete = cleanupMode.equals("zero");
                    provider.resolver.failDelete = cleanupMode.equals("throw");
                    SharedPreferences disk = previousSuccess(); MainActivity a = new MainActivity(disk); a.granted = true;
                    java.util.concurrent.CountDownLatch failed = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1);
                    a.queueExport(() -> {
                        try {
                            byte[] bytes = "companion".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                            new app.passengercount.ExportStorage(provider).saveBundle("joined", "joined", bytes, bytes, bytes, bytes);
                            throw new AssertionError("injected failure missing");
                        } catch (Exception actualWriterFailure) {
                            failed.countDown();
                            try { release.await(); } catch (InterruptedException interrupted) { throw new AssertionError(interrupted); }
                            disk.fail = failedCommit;
                            a.exportFailure(actualWriterFailure);
                        }
                    });
                    check(failed.await(5, java.util.concurrent.TimeUnit.SECONDS), "actual writer reached rollback outcome");
                    MainActivity visible = a;
                    if (recreate) { a.onPause(); visible = new MainActivity(disk); a.onDestroy(); }
                    release.countDown();
                    if (recreate) check(a.exports.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS), "old executor finishes actual writer outcome");
                    else a.drain();
                    boolean uncertain = !cleanupMode.equals("confirmed");
                    String expected = uncertain ? UNCERTAIN : FAILURE;
                    try {
                        check(expected.equals(visible.result()), "actual writer exception maps to correct live outcome");
                        check(expected.equals(visible.events.get(visible.events.size() - 1)), "current observer receives settled actual-writer outcome");
                        check(!exportSession.busy(), "actual-writer failure releases pending controls");
                        check((uncertain || failedCommit ? UNCERTAIN : FAILURE).equals(disk.restart().getString("result", null)), "durable restart remains conservative");
                        check(provider.resolver.bytes.size() == (uncertain ? 2 : 0), "outcome matches actual retained bytes");
                        check(provider.resolver.entries.size() == (uncertain ? (treeDestination ? 4 : 3) : 0), "outcome matches retained rows");
                        check(provider.resolver.deletes == (treeDestination ? (uncertain ? 1 : 4) : 3), "all known rollback operations attempted");
                        check(provider.resolver.opens == 3, "no automatic replay after failure");
                    } finally { visible.onDestroy(); }
                    MainActivity restarted = new MainActivity(disk.restart());
                    try {
                        check(restarted.events.contains(uncertain || failedCommit ? UNCERTAIN : FAILURE), "restart observer receives conservative final result");
                        check(provider.resolver.opens == 3, "restart never replays writer");
                    } finally { restarted.onDestroy(); }
                });
            }
'''
fixture=fixture.replace(marker,extra+'\n'+marker)
(root/'tests/native/JoinedReviewFixture.java').write_text(fixture)
s=(root/'scripts/test-export-permission.cjs').read_text().replace("tests/native/ExportPermissionFixture.java","tests/native/JoinedReviewFixture.java")
s=s.replace(".replace('/* PRODUCTION_METHODS */', methods);", ".replace('/* PRODUCTION_METHODS */', methods).replaceAll('ExportStorage.UncertainExportException', 'app.passengercount.ExportStorage.UncertainExportException');")
s=s.replace("const build = fs.mkdtempSync", "function javaFiles(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => { const file = path.join(directory, entry.name); return entry.isDirectory() ? javaFiles(file) : file.endsWith('.java') ? [file] : []; }); }\nconst build = fs.mkdtempSync")
s=s.replace("path.join(root, 'android/src/app/passengercount/ExportSession.java')]))", "path.join(root, 'android/src/app/passengercount/ExportSession.java'), path.join(root, 'android/src/app/passengercount/ExportStorage.java'), ...javaFiles(path.join(root, 'tests/native/storage-stubs'))]))")
(root/'scripts/review-joined-writer-lifecycle.cjs').write_text(s)
