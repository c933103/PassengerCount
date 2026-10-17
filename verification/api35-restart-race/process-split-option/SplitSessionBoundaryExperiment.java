package app.passengercount;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
/** One-time architecture boundary experiment, not an Android process test. */
public final class SplitSessionBoundaryExperiment {
  static final class Store implements TrackSession.Store {
    volatile TrackSession.Request value=new TrackSession.Request("survey", "generation");
    public TrackSession.Request read(){return value;}
    public boolean write(TrackSession.Request value){this.value=value;return true;}
  }
  static void check(boolean ok,String msg){if(!ok)throw new AssertionError(msg);System.out.println("PASS "+msg);}
  static void scenario(boolean sharedController) throws Exception {
    Store store=new Store();
    TrackSession service=new TrackSession(store);
    TrackSession ui=sharedController?service:new TrackSession(store);
    TrackSession.Request accepted=service.request();
    CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),returned=new CountDownLatch(1);
    AtomicBoolean writeFinished=new AtomicBoolean(),stopSucceeded=new AtomicBoolean();
    AtomicReference<Throwable> error=new AtomicReference<>();
    Thread writer=new Thread(()->{try{service.append(accepted,()->{entered.countDown();try{if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("write release timeout");}catch(InterruptedException e){throw new RuntimeException(e);}writeFinished.set(true);});}catch(Throwable t){error.set(t);}},"accepted-append");
    Thread stopper=new Thread(()->{try{stopSucceeded.set(ui.stop("survey"));returned.countDown();}catch(Throwable t){error.set(t);}},"stop-and-drain");
    writer.start();check(entered.await(2,TimeUnit.SECONDS),"accepted append entered with controller lock, shared="+sharedController);stopper.start();
    try {
      if(sharedController){
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
        while(stopper.getState()!=Thread.State.BLOCKED && System.nanoTime()<until)Thread.yield();
        check(stopper.getState()==Thread.State.BLOCKED && returned.getCount()==1,"single controller blocks stop until accepted append drains");
      }else{
        check(returned.await(2,TimeUnit.SECONDS) && stopSucceeded.get() && !writeFinished.get(),"two controllers let acknowledged stop return before accepted append finishes");
      }
    } finally {release.countDown();writer.join(2000);stopper.join(2000);}
    check(!writer.isAlive()&&!stopper.isAlive()&&error.get()==null&&writeFinished.get()&&stopSucceeded.get(),"bounded threads finished without hidden error, shared="+sharedController);
  }
  public static void main(String[] args)throws Exception{scenario(true);scenario(false);System.out.println("6 controls passed against unchanged TrackSession; independent monitor boundary only, not an installed-process test");}
}
