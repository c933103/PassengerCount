#!/usr/bin/env node
// Execute production Activity queue/callback/lifecycle methods with simulated
// Android 26/28 permission APIs. This is not an emulator/device test.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'android/src/app/passengercount/MainActivity.java'), 'utf8');
const fields = source.split('public final class MainActivity extends Activity {')[1].split('@Override public void onCreate')[0];
function method(signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw Error(`Missing production method: ${signature}`);
  const open = source.indexOf('{', start);
  // The selected methods contain no brace characters in strings/comments except
  // balanced JSON literals. Preserve their complete bodies, never copies.
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  if (depth) throw Error(`Unbalanced production method: ${signature}`);
  return source.slice(start, end);
}
const methods = [
  'public void onRequestPermissionsResult(',
  'private void queueExport(',
  'protected void onDestroy()',
  'public String getExportResult()',
].map(method).join('\n');
const fixture = fs.readFileSync(path.join(root, 'tests/native/ExportPermissionFixture.java'), 'utf8')
  .replace('/* PRODUCTION_FIELDS */', fields)
  .replace('/* PRODUCTION_METHODS */', methods);
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'passengercount-permission-'));
try {
  fs.writeFileSync(path.join(build, 'MainActivity.java'), fixture);
  function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
    return result.status === 0;
  }
  if (run('java', ['com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-d', build,
      path.join(build, 'MainActivity.java')])) run('java', ['-cp', build, 'app.passengercount.MainActivity']);
} finally { fs.rmSync(build, { recursive: true, force: true }); }
