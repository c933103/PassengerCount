/*
 * Two methods copied unchanged from Android Open Source Project:
 * frameworks/base 4e43ad12e1b211f15152e9c5b16b0fe88e6b93f3
 * services/core/java/com/android/server/am/ActiveServices.java.
 * Copyright (C) 2012 The Android Open Source Project.
 * Licensed under the Apache License, Version 2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, distributed
 * on an AS IS BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
 *
 * One-time source-path reproduction, not Android execution or a CI gate.
 * The two marked methods are unchanged. Surrounding classes are explicit
 * doubles; stopAllForegroundServicesLocked records its call only.
 */
import java.util.*;
public final class AospForegroundGap {
  static final boolean DEBUG_FOREGROUND_SERVICE = false;
  static final String TAG = "fixture";
  static class SystemClock { static long elapsedRealtime(){return 100;} static long uptimeMillis(){return 100;} }
  static class Slog { static void d(String tag,String message){} }
  static class Message {}
  static class ListMap<K,V> extends LinkedHashMap<K,V> {
    V valueAt(int index){return new ArrayList<>(values()).get(index);}
    K keyAt(int index){return new ArrayList<>(keySet()).get(index);}
  }
  static class ProcessRecord { boolean allowed = true; }
  static class UidRecord {
    Map<String,ProcessRecord> processes = new HashMap<>();
    ProcessRecord getProcessInPackage(String name){return processes.get(name);}
  }
  static class ProcessList {
    Map<Integer,UidRecord> uids=new HashMap<>();
    UidRecord getUidRecordLOSP(int uid){return uids.get(uid);}
  }
  static class ActivityManager { ProcessList mProcessList = new ProcessList(); }
  static class ActiveForegroundApp {
    int mUid; String mPackageName; long mEndTime, mHideTime=Long.MAX_VALUE; boolean mAppOnTop;
  }
  static class ServiceMap {
    static final int MSG_UPDATE_FOREGROUND_APPS=1;
    int mUserId; boolean mActiveForegroundAppsChanged;
    ListMap<String,ActiveForegroundApp> mActiveForegroundApps=new ListMap<>();
    ArrayList<String> mPendingRemoveForegroundApps=new ArrayList<>();
    void removeMessages(int code){}
    Message obtainMessage(int code){return new Message();}
    void sendMessageAtTime(Message m,long time){}
  }
  final ActivityManager mAm=new ActivityManager();
  final List<String> demotions=new ArrayList<>();
  boolean foregroundAppShownEnoughLocked(ActiveForegroundApp app,long now){return true;}
  boolean isForegroundServiceAllowedInBackgroundRestricted(ProcessRecord app){return app.allowed;}
  void stopAllForegroundServicesLocked(int uid,String pkg){demotions.add(pkg);}
  // BEGIN unchanged AOSP method
void updateForegroundApps(ServiceMap smap) {
        // This is called from the handler without the lock held.
        synchronized (mAm) {
            final long now = SystemClock.elapsedRealtime();
            long nextUpdateTime = Long.MAX_VALUE;
            if (smap != null) {
                if (DEBUG_FOREGROUND_SERVICE) Slog.d(TAG, "Updating foreground apps for user "
                        + smap.mUserId);
                smap.mPendingRemoveForegroundApps.clear();
                for (int i = smap.mActiveForegroundApps.size()-1; i >= 0; i--) {
                    ActiveForegroundApp aa = smap.mActiveForegroundApps.valueAt(i);
                    if (aa.mEndTime != 0) {
                        boolean canRemove = foregroundAppShownEnoughLocked(aa, now);
                        if (canRemove) {
                            // This was up for longer than the timeout, so just remove immediately.
                            smap.mPendingRemoveForegroundApps.add(smap.mActiveForegroundApps.keyAt(i));
                            smap.mActiveForegroundAppsChanged = true;
                            continue;
                        }
                        if (aa.mHideTime < nextUpdateTime) {
                            nextUpdateTime = aa.mHideTime;
                        }
                    }
                    if (!aa.mAppOnTop) {
                        // Transitioning a fg-service host app out of top: if it's bg restricted,
                        // it loses the fg service state now.
                        if (isForegroundServiceAllowedInBackgroundRestricted(
                                aa.mUid, aa.mPackageName)) {
                            if (DEBUG_FOREGROUND_SERVICE) Slog.d(TAG, "Adding active: pkg="
                                    + aa.mPackageName + ", uid=" + aa.mUid);
                        } else {
                            if (DEBUG_FOREGROUND_SERVICE) {
                                Slog.d(TAG, "bg-restricted app "
                                        + aa.mPackageName + "/" + aa.mUid
                                        + " exiting top; demoting fg services ");
                            }
                            stopAllForegroundServicesLocked(aa.mUid, aa.mPackageName);
                        }
                    }
                }
                for(int i = smap.mPendingRemoveForegroundApps.size() - 1; i >= 0; i--) {
                    smap.mActiveForegroundApps.remove(smap.mPendingRemoveForegroundApps.get(i));
                }
                smap.removeMessages(ServiceMap.MSG_UPDATE_FOREGROUND_APPS);
                if (nextUpdateTime < Long.MAX_VALUE) {
                    if (DEBUG_FOREGROUND_SERVICE) Slog.d(TAG, "Next update time in: "
                            + (nextUpdateTime-now));
                    Message msg = smap.obtainMessage(ServiceMap.MSG_UPDATE_FOREGROUND_APPS);
                    smap.sendMessageAtTime(msg, nextUpdateTime
                            + SystemClock.uptimeMillis() - SystemClock.elapsedRealtime());
                }
            }
            smap.mActiveForegroundAppsChanged = false;
        }
    }
private boolean isForegroundServiceAllowedInBackgroundRestricted(int uid, String packageName) {
        final UidRecord uidRec = mAm.mProcessList.getUidRecordLOSP(uid);
        ProcessRecord app = null;
        return uidRec != null && ((app = uidRec.getProcessInPackage(packageName)) != null)
                && isForegroundServiceAllowedInBackgroundRestricted(app);
    }

  // END unchanged AOSP methods
  static int assertions;
  static void check(boolean pass,String label){assertions++;if(!pass)throw new AssertionError(label);System.out.println("PASS "+label);}
  static AospForegroundGap scenario(int uidMode,boolean top,boolean ended,boolean update) {
    AospForegroundGap f=new AospForegroundGap();
    ServiceMap map=new ServiceMap();
    ActiveForegroundApp app=new ActiveForegroundApp();
    app.mUid=10209;app.mPackageName="app.passengercount";app.mAppOnTop=top;app.mEndTime=ended?1:0;
    map.mActiveForegroundApps.put(app.mPackageName,app);
    if(uidMode!=0){
      UidRecord uid=new UidRecord();f.mAm.mProcessList.uids.put(app.mUid,uid);
      if(uidMode>=2){ProcessRecord process=new ProcessRecord();process.allowed=uidMode==2;uid.processes.put(app.mPackageName,process);}
    }
    if(update)f.updateForegroundApps(map);
    return f;
  }
  public static void main(String[] args) {
    check(scenario(0,false,false,true).demotions.size()==1,"absent UID during pending restart is demoted by shared pass");
    check(scenario(1,false,false,true).demotions.size()==1,"UID exists but package process absent is also demoted");
    check(scenario(2,false,false,true).demotions.isEmpty(),"live unrestricted process keeps foreground eligibility");
    check(scenario(3,false,false,true).demotions.size()==1,"live restricted process is demoted as intended");
    check(scenario(0,true,false,true).demotions.isEmpty(),"on-top entry skips background demotion");
    check(scenario(0,false,true,true).demotions.isEmpty(),"ended visible entry is removed before demotion");
    check(scenario(0,false,false,false).demotions.isEmpty(),"without shared pass no demotion occurs in this model");
    System.out.println(assertions+" source-path assertions passed; not an installed-device result");
  }
}
