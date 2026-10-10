#!/usr/bin/env node
// Run source-extracted native bridge/service methods, unchanged production
// TrackDeletion/TrackSession/TrackJournal, and host-only Android/JSON shims.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), build = fs.mkdtempSync(path.join(os.tmpdir(), 'passengercount-delete-'));
function method(source, signature) {
  const start = source.indexOf(signature), open = source.indexOf('{', start);
  if (start < 0) throw Error(`Missing production method: ${signature}`);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  if (depth) throw Error('Unbalanced production method');
  return source.slice(start, end);
}
function write(name, content) { const p = path.join(build, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; }
try {
  const activity = fs.readFileSync(path.join(root, 'android/src/app/passengercount/MainActivity.java'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'android/src/app/passengercount/TrackService.java'), 'utf8');
  const fixture = fs.readFileSync(path.join(root, 'tests/native/TrackDeletionFixture.java'), 'utf8')
    .replace('/* BRIDGE_METHODS */', ['public boolean deleteTrack(', 'public void startTracking(', 'public String getTrackPage(', 'public String getTrack('].map(x => method(activity, x)).join('\n'))
    .replace('/* SERVICE_METHODS */', ['public int onStartCommand(', 'static synchronized TrackSession session(', 'static void finishStop(', 'static String safeId(', 'static File trackFile(', 'static boolean isDeleted(', 'static boolean deleteTrack('].map(x => method(service, x)).join('\n'));
  const sources = [write('MainActivity.java', fixture)];
  sources.push(write('android/system/ErrnoException.java', 'package android.system; public class ErrnoException extends Exception {}'));
  // Match public SDK names; an invented O_DIRECTORY stub hid an Android build error.
  sources.push(write('android/system/OsConstants.java', 'package android.system; public class OsConstants { public static final int O_RDONLY=0; public static boolean S_ISDIR(int mode) { return (mode & 0170000) == 0040000; } }'));
  sources.push(write('android/system/StructStat.java', 'package android.system; public class StructStat { public final int st_mode; public StructStat(int mode) { st_mode=mode; } }'));
  sources.push(write('android/system/Os.java', `package android.system;
    import java.io.*; import java.nio.channels.*; import java.nio.file.*; import java.util.*;
    public class Os {
      public static boolean failOpen, failStat, notDirectory, failSync, failClose;
      public static int syncs, closes;
      private static final Map<FileDescriptor,FileChannel> channels = new HashMap<>();
      private static final Map<FileDescriptor,Integer> modes = new HashMap<>();
      public static int openDescriptors() { return channels.size(); }
      public static FileDescriptor open(String p, int flags, int mode) throws ErrnoException {
        if (flags != OsConstants.O_RDONLY) throw new AssertionError("unexpected public open flags");
        if (failOpen) throw new ErrnoException();
        try { FileDescriptor fd = new FileDescriptor(); channels.put(fd, FileChannel.open(Paths.get(p), StandardOpenOption.READ)); modes.put(fd, Files.isDirectory(Paths.get(p)) ? 0040000 : 0100000); return fd; }
        catch (IOException e) { throw new ErrnoException(); }
      }
      public static StructStat fstat(FileDescriptor fd) throws ErrnoException {
        if (failStat) throw new ErrnoException();
        return new StructStat(notDirectory ? 0100000 : modes.get(fd));
      }
      public static void fsync(FileDescriptor fd) throws ErrnoException {
        syncs++; if (failSync) throw new ErrnoException();
        try { channels.get(fd).force(true); } catch (IOException e) { throw new ErrnoException(); }
      }
      public static void close(FileDescriptor fd) throws ErrnoException {
        closes++; modes.remove(fd);
        try { channels.remove(fd).close(); if (failClose) throw new ErrnoException(); } catch (IOException e) { throw new ErrnoException(); }
      }
    }`));
  sources.push(write('org/json/JSONException.java', 'package org.json; public class JSONException extends RuntimeException {}'));
  sources.push(write('org/json/JSONObject.java', `package org.json;
    public class JSONObject { private String raw="{}"; public JSONObject() {} public JSONObject(String s) { raw=s; }
      public Object opt(String key) { return null; } public String optString(String key) { return ""; }
      public JSONObject put(String key,Object value) { return this; } public String toString() { return raw; } }`));
  sources.push(write('org/json/JSONArray.java', `package org.json; import java.util.*;
    public class JSONArray { private final List<Object> items=new ArrayList<>(); public JSONArray put(Object x) { items.add(x);return this; }
      public String toString() { return items.toString(); } }`));
  for (const name of ['TrackDeletion', 'TrackSession', 'TrackJournal']) sources.push(path.join(root, `android/src/app/passengercount/${name}.java`));
  const run = args => { const r = spawnSync('java', args, { stdio: 'inherit' }); if (r.error) throw r.error; if (r.status) process.exitCode = r.status; return r.status === 0; };
  if (run(['com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-d', build, ...sources]))
    run([`-Djava.io.tmpdir=${build}`, '-cp', build, 'app.passengercount.MainActivity']);
} finally { fs.rmSync(build, { recursive: true, force: true }); }
