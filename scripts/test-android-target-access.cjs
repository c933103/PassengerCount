#!/usr/bin/env node
// JVM defining-classloader regression, not Android runtime validation.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), build = fs.mkdtempSync(path.join(os.tmpdir(), 'passenger-loaders-'));
function write(name, content) { const p=path.join(build,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);return p; }
function run(args) { const p=spawnSync('java',args,{stdio:'inherit'});if(p.error)throw p.error;if(p.status!==0)throw Error(`Java exited ${p.status}`); }
try {
  const harness=fs.readFileSync(path.join(root,'tests/android/JournalLifecycleInstrumentation.java'),'utf8');
  assert.doesNotMatch(harness,/\bTrackSession\b/, 'nonpublic session/request types must not enter instrumentation bytecode');
  assert.doesNotMatch(harness,/\bTrackService\s*\.\s*(?!class\b)\w+/, 'nonpublic target members require test reflection');
  const target=path.join(build,'target'), child=path.join(build,'child'), host=path.join(build,'host');
  for(const p of [target,child,host])fs.mkdirSync(p);
  // Public service facade mirrors the target's package-private access boundary.
  // TrackSession itself is the unchanged production class, not a substitute.
  const service=write('target-src/app/passengercount/TrackService.java',`package app.passengercount;
    public final class TrackService {
      static final String ACTION_START="start";
      static final TrackSession control=new TrackSession(new TrackSession.Store() {
        TrackSession.Request value=new TrackSession.Request("", "");
        public TrackSession.Request read(){return value;}
        public boolean write(TrackSession.Request next){value=next;return true;}
      });
      static TrackSession session(Object context){return control;}
      static boolean isDeleted(Object context,String id){return id.equals("deleted");}
      static void fail(){throw new IllegalStateException("target failure");}
    }`);
  run(['com.sun.tools.javac.Main','-d',target,service,path.join(root,'android/src/app/passengercount/TrackSession.java')]);
  const negative=write('child-src/app/passengercount/NegativeProbe.java',`package app.passengercount;
    public class NegativeProbe { public static void run(){ TrackService.session(null).request(); } }`);
  const positive=write('child-src/app/passengercount/PositiveProbe.java',`package app.passengercount;
    import java.util.concurrent.atomic.AtomicInteger;
    public class PositiveProbe {
      static int n; static void check(boolean x){n++;if(!x)throw new AssertionError("check "+n);}
      public static int run() throws Exception {
        check(TargetAccess.class.getClassLoader()!=TrackService.class.getClassLoader());
        Object control=TargetAccess.callStatic(TrackService.class,"session",new Object());
        check(control.getClass().getClassLoader()==TrackService.class.getClassLoader());
        check(TargetAccess.field(TargetAccess.call(control,"request"),"id").equals(""));
        Object request=TargetAccess.call(control,"start","A");
        check(TargetAccess.field(request,"id").equals("A"));
        check(!((String)TargetAccess.field(request,"token")).isEmpty());
        check((Boolean)TargetAccess.call(control,"accepts",request));
        AtomicInteger writes=new AtomicInteger();
        TargetAccess.call(control,"append",request,(Runnable)writes::incrementAndGet);
        check(writes.get()==1);
        check((Boolean)TargetAccess.call(control,"stop","A"));
        check(!(Boolean)TargetAccess.call(control,"accepts",request));
        TargetAccess.call(control,"append",request,(Runnable)writes::incrementAndGet);
        check(writes.get()==1);
        check(TargetAccess.staticField(TrackService.class,"ACTION_START").equals("start"));
        check((Boolean)TargetAccess.callStatic(TrackService.class,"isDeleted",new Object(),"deleted"));
        check(!(Boolean)TargetAccess.callStatic(TrackService.class,"isDeleted",new Object(),"other"));
        try{TargetAccess.callStatic(TrackService.class,"fail");throw new AssertionError("missing failure");}
        catch(IllegalStateException expected){check(expected.getMessage().equals("target failure"));}
        return n;
      }
    }`);
  run(['com.sun.tools.javac.Main','-cp',target,'-d',child,negative,positive,path.join(root,'tests/android/TargetAccess.java')]);
  const main=write('LoaderFixture.java',`import java.net.*; import java.io.*; import java.lang.reflect.*;
    public class LoaderFixture {
      public static void main(String[] args)throws Exception {
        try(URLClassLoader target=new URLClassLoader(new URL[]{new File(args[0]).toURI().toURL()},ClassLoader.getSystemClassLoader());
            URLClassLoader child=new URLClassLoader(new URL[]{new File(args[1]).toURI().toURL()},target)) {
          try {child.loadClass("app.passengercount.NegativeProbe").getMethod("run").invoke(null);throw new AssertionError("direct package access unexpectedly passed");}
          catch(InvocationTargetException e){if(!(e.getCause() instanceof IllegalAccessError))throw e;System.out.println("PASS: original direct package access fails across defining classloaders");}
          Object count=child.loadClass("app.passengercount.PositiveProbe").getMethod("run").invoke(null);
          System.out.println("TargetAccess: "+count+" assertions passed with unchanged TrackSession and separate target/instrumentation loaders");
        }
      }
    }`);
  run(['com.sun.tools.javac.Main','-d',host,main]);
  run(['-cp',host,'LoaderFixture',target,child]);
} finally { fs.rmSync(build,{recursive:true,force:true}); }
