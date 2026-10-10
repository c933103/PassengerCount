#!/usr/bin/env node
// Compile the actual writer with host-only Android API stubs. An optional source
// argument supports a frozen-source negative control without copying production.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] || path.join(root, 'android/src/app/passengercount/ExportStorage.java');
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'passengercount-storage-'));
function javaFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? javaFiles(file) : file.endsWith('.java') ? [file] : [];
  });
}
function run(args) {
  const result = spawnSync('java', args, { stdio: 'inherit', env: { ...process.env, TMPDIR: build } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  return result.status === 0;
}
try {
  const stubs = javaFiles(path.join(root, 'tests/native/storage-stubs'));
  if (run(['com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-d', build,
      source, ...stubs, path.join(root, 'tests/native/ExportStorageTest.java')]))
    run([`-Djava.io.tmpdir=${build}`, '-cp', build, 'app.passengercount.ExportStorageTest']);
} finally { fs.rmSync(build, { recursive: true, force: true }); }
