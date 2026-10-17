/*
 * Host-only candidate predicate experiment. Android framework method adapted from
 * AOSP frameworks/base 4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3 ActiveServices.java.
 * Copyright (C) 2012 The Android Open Source Project.
 * Licensed under the Apache License, Version 2.0; see LICENSE-AOSP.txt.
 * Provided AS IS, without warranties or conditions of any kind.
 * Everything outside the candidate method is an explicit minimal test double.
 */
import java.util.*;
public final class PlatformFallbackExperiment {
  static class ProcessRecord { boolean allowed; ProcessRecord(boolean a){allowed=a;} }
  static class UidRecord { ProcessRecord process; ProcessRecord getProcessInPackage(String p){return process;} }
  static class ProcessList { UidRecord uid; UidRecord getUidRecordLOSP(int id){return uid;} }
  static class ActivityManager { ProcessList mProcessList=new ProcessList(); }
  static class AppStateTracker { boolean restricted; boolean isAppBackgroundRestricted(int u,String p){return restricted;} }
  final ActivityManager mAm=new ActivityManager();
  AppStateTracker tracker=new AppStateTracker();
  AppStateTracker getAppStateTracker(){return tracker;}
  boolean isForegroundServiceAllowedInBackgroundRestricted(ProcessRecord app){return app.allowed;}
    private boolean isForegroundServiceAllowedInBackgroundRestricted(int uid, String packageName) {
        final UidRecord uidRec = mAm.mProcessList.getUidRecordLOSP(uid);
        final ProcessRecord app = uidRec == null ? null : uidRec.getProcessInPackage(packageName);
        if (app != null) {
            return isForegroundServiceAllowedInBackgroundRestricted(app);
        }
        // A process can be absent during a pending sticky restart. Absence is
        // not itself background restriction; preserve the saved authorization
        // for unrestricted packages, but still demote actually restricted apps.
        // Fail closed if the package restriction state is unavailable.
        final AppStateTracker tracker = getAppStateTracker();
        return tracker != null && !tracker.isAppBackgroundRestricted(uid, packageName);
    }
  static int checks;
  static void check(boolean v,String label){checks++;if(!v)throw new AssertionError(label);System.out.println("PASS "+label);}
  static boolean actual(int process,Boolean restricted) {
    PlatformFallbackExperiment f=new PlatformFallbackExperiment();
    if(process>0){f.mAm.mProcessList.uid=new UidRecord();if(process>1)f.mAm.mProcessList.uid.process=new ProcessRecord(process==2);}
    if(restricted==null)f.tracker=null;else f.tracker.restricted=restricted;
    return f.isForegroundServiceAllowedInBackgroundRestricted(10209,"app.passengercount");
  }
  public static void main(String[] args) {
    for(int absent:new int[]{0,1}) {
      check(actual(absent,false),"absent mode "+absent+" retains unrestricted package eligibility");
      check(!actual(absent,true),"absent mode "+absent+" still demotes actually restricted package");
      check(!actual(absent,null),"absent mode "+absent+" fails closed for unknown restriction state");
    }
    for(Boolean restriction:new Boolean[]{false,true,null}) {
      check(actual(2,restriction),"live eligible process path unchanged, tracker="+restriction);
      check(!actual(3,restriction),"live ineligible process path unchanged, tracker="+restriction);
    }
    System.out.println(checks+" candidate predicate controls passed; not an Android build/device result");
  }
}
