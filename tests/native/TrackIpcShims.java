package app.passengercount;
import java.io.*;
import java.util.*;

/** Host transport doubles only; the client/provider method bodies are production source. */
class Bundle {
    final Map<String,Object> values = new HashMap<>();
    void putString(String k,String v) { values.put(k,v); }
    String getString(String k) { return getString(k,null); }
    String getString(String k,String fallback) { Object v=values.get(k);return v instanceof String?(String)v:fallback; }
    void putBoolean(String k,boolean v) { values.put(k,v); }
    boolean getBoolean(String k,boolean fallback) { Object v=values.get(k);return v instanceof Boolean?(Boolean)v:fallback; }
    void putInt(String k,int v) { values.put(k,v); }
    int getInt(String k) { return getInt(k,0); }
    int getInt(String k,int fallback) { Object v=values.get(k);return v instanceof Integer?(Integer)v:fallback; }
    void putParcelable(String k,ParcelFileDescriptor v) { values.put(k,v); }
    ParcelFileDescriptor getParcelable(String k) { return (ParcelFileDescriptor)values.get(k); }
}
class Binder { static int uid=100; static int getCallingUid() { return uid; } }
class RemoteException extends Exception {}
class ContentResolver {
    final Context context; static boolean unavailable; static int acquired;
    ContentResolver(Context context) { this.context=context; }
    ContentProviderClient acquireUnstableContentProviderClient(String authority) {
        if (!authority.equals("app.passengercount.tracking")) throw new AssertionError("Wrong owner");
        acquired++; return unavailable ? null : new ContentProviderClient(context);
    }
}
class ContentProviderClient implements AutoCloseable {
    final TrackProvider owner=new TrackProvider();
    static boolean failBefore, failAfter; static int closed, calls;
    ContentProviderClient(Context context) { owner.context=context; }
    Bundle call(String method,String id,Bundle extras) throws RemoteException {
        calls++;
        if (failBefore) throw new RemoteException();
        Bundle result=owner.call(method,id,extras);
        if (failAfter) throw new RemoteException();
        return result;
    }
    ParcelFileDescriptor openFile(Uri uri,String mode) throws RemoteException,FileNotFoundException {
        if(failBefore)throw new RemoteException();return owner.openFile(uri,mode);
    }
    public void close() { closed++; }
}
abstract class ContentProvider {
    Context context; Context getContext() { return context; }
    public abstract ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException;
    public abstract boolean onCreate();
    public abstract Bundle call(String method,String arg,Bundle extras);
    public abstract Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort);
    public abstract String getType(Uri uri);
    public abstract Uri insert(Uri uri,ContentValues values);
    public abstract int delete(Uri uri,String selection,String[] args);
    public abstract int update(Uri uri,ContentValues values,String selection,String[] args);
}
class Cursor {} class ContentValues {}
class Uri {
    String authority,path;
    String getAuthority() { return authority; }
    String getLastPathSegment() { return path; }
    List<String> getPathSegments() { return Collections.singletonList(path); }
    static class Builder {
        Uri uri=new Uri(); Builder scheme(String ignored) { return this; }
        Builder authority(String value) { uri.authority=value;return this; }
        Builder appendPath(String value) { uri.path=value;return this; }
        Uri build() { return uri; }
    }
}
class Looper { static Looper getMainLooper() { return new Looper(); } }
class Handler { Handler(Looper l) {} void post(Runnable task) { task.run(); } }
class ParcelFileDescriptor {
    static boolean failWrite;
    static class Pipe { PipedInputStream in; PipedOutputStream out; String error;
        Pipe() throws IOException { in=new PipedInputStream(8192);out=new PipedOutputStream(in); } }
    final Pipe pipe; final boolean read;
    ParcelFileDescriptor(Pipe pipe,boolean read) { this.pipe=pipe;this.read=read; }
    static ParcelFileDescriptor[] createReliablePipe() throws IOException { Pipe p=new Pipe();return new ParcelFileDescriptor[]{new ParcelFileDescriptor(p,true),new ParcelFileDescriptor(p,false)}; }
    void close() throws IOException { if(read)pipe.in.close();else pipe.out.close(); }
    void checkError() throws IOException { if(pipe.error!=null) throw new IOException(pipe.error); }
    void closeWithError(String message) throws IOException { pipe.error=message;pipe.out.close(); }
    static class AutoCloseOutputStream extends FilterOutputStream {
        AutoCloseOutputStream(ParcelFileDescriptor fd) { super(fd.pipe.out); }
        public void write(byte[] bytes,int offset,int count) throws IOException {
            if(failWrite) { out.write(bytes,offset,Math.min(1,count));throw new IOException("Interrupted fixture pipe"); }
            out.write(bytes,offset,count);
        }
    }
    static class AutoCloseInputStream extends FilterInputStream { AutoCloseInputStream(ParcelFileDescriptor fd) { super(fd.pipe.in); } }
}
