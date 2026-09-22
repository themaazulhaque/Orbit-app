package com.chronicle.app;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.json.JSONArray;

public class ChronicleUsageModule extends ReactContextBaseJavaModule {
  private static final String TAG = "[Orbit Tracking]";
  private final ReactApplicationContext context;
  private final java.util.concurrent.Executor executor = Executors.newSingleThreadExecutor();

  public ChronicleUsageModule(ReactApplicationContext context) {
    super(context);
    this.context = context;
  }

  @Override
  public String getName() {
    return "ChronicleUsageModule";
  }

  @ReactMethod
  public void isUsageAccessGranted(Promise promise) {
    try {
      promise.resolve(TrackingStore.isUsageAccessGranted(context));
    } catch (Exception error) {
      promise.reject("USAGE_ACCESS_CHECK_FAILED", error);
    }
  }

  @ReactMethod
  public void getInstallationId(Promise promise) {
    try {
      promise.resolve(TrackingStore.getInstallationId(context));
    } catch (Exception error) {
      promise.reject("INSTALLATION_ID_FAILED", error);
    }
  }

  @ReactMethod
  public void openUsageAccessSettings(Promise promise) {
    try {
      context.startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("USAGE_ACCESS_SETTINGS_FAILED", error);
    }
  }

  @ReactMethod
  public void getInstalledApps(Promise promise) {
    try {
      PackageManager packageManager = context.getPackageManager();
      List<ApplicationInfo> installed = packageManager.getInstalledApplications(PackageManager.GET_META_DATA);
      WritableArray result = Arguments.createArray();
      for (ApplicationInfo info : installed) {
        if (info.packageName.equals(context.getPackageName())) continue;
        boolean system = (info.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        if (system && packageManager.getLaunchIntentForPackage(info.packageName) == null) continue;
        WritableMap app = Arguments.createMap();
        app.putString("packageName", info.packageName);
        app.putString("appName", String.valueOf(packageManager.getApplicationLabel(info)));
        app.putBoolean("isSystemApp", system);
        String icon = iconData(packageManager.getApplicationIcon(info));
        if (icon != null) app.putString("icon", icon);
        result.pushMap(app);
      }
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("INSTALLED_APPS_FAILED", error);
    }
  }

  @ReactMethod
  public void getUsageStats(double startTime, double endTime, Promise promise) {
    try {
      UsageStatsManager manager = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
      List<UsageStats> stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_BEST, (long) startTime, (long) endTime);
      Map<String, UsageStats> merged = new HashMap<>();
      for (UsageStats item : stats) {
        if (item.getTotalTimeInForeground() <= 0) continue;
        UsageStats existing = merged.get(item.getPackageName());
        if (existing == null) {
          merged.put(item.getPackageName(), item);
        } else {
          existing.add(item);
        }
      }
      WritableArray result = Arguments.createArray();
      for (UsageStats item : merged.values()) {
        WritableMap record = Arguments.createMap();
        record.putString("packageName", item.getPackageName());
        record.putDouble("lastTimeUsed", item.getLastTimeUsed());
        record.putDouble("totalTimeInForeground", item.getTotalTimeInForeground());
        result.pushMap(record);
      }
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("USAGE_STATS_FAILED", error);
    }
  }

  @ReactMethod
  public void getStoredUsageStats(double startTime, double endTime, Promise promise) {
    try {
      List<UsageSummaryRecord> records = TrackingStore.getStoredUsageStats(context, (long) startTime, (long) endTime);
      WritableArray result = Arguments.createArray();
      for (UsageSummaryRecord record : records) {
        WritableMap item = Arguments.createMap();
        item.putString("packageName", record.getPackageName());
        item.putDouble("lastTimeUsed", record.getLastTimeUsed());
        item.putDouble("totalTimeInForeground", record.getTotalTimeInForeground());
        result.pushMap(item);
      }
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("STORED_USAGE_STATS_FAILED", error);
    }
  }

  @ReactMethod
  public void getTrackingStatus(Promise promise) {
    try {
      WritableMap result = Arguments.createMap();
      TrackingSummary summary = TrackingStore.getTrackingSummary(context);
      result.putBoolean("usageAccessGranted", summary.getUsageAccessGranted());
      result.putBoolean("collectionScheduled", summary.getCollectionScheduled());
      result.putBoolean("syncScheduled", summary.getSyncScheduled());
      result.putBoolean("trackingActive", summary.getTrackingActive());
      result.putBoolean("networkAvailable", summary.getNetworkAvailable());
      result.putBoolean("authenticated", summary.getAuthenticated());
      if (summary.getDeviceId() != null) result.putString("deviceId", summary.getDeviceId()); else result.putNull("deviceId");
      if (summary.getLastCollectionAt() != null) result.putDouble("lastCollectionAt", summary.getLastCollectionAt().doubleValue()); else result.putNull("lastCollectionAt");
      if (summary.getLastSyncAt() != null) result.putDouble("lastSyncAt", summary.getLastSyncAt().doubleValue()); else result.putNull("lastSyncAt");
      result.putInt("pendingSyncCount", summary.getPendingSyncCount());
      promise.resolve(result);
    } catch (Exception error) {
      promise.reject("TRACKING_STATUS_FAILED", error);
    }
  }

  @ReactMethod
  public void getLastCollectionTime(Promise promise) {
    try {
      Long value = TrackingStore.getLastCollectionTimestamp(context);
      if (value == null) {
        promise.resolve(null);
      } else {
        promise.resolve((double) value);
      }
    } catch (Exception error) {
      promise.reject("LAST_COLLECTION_FAILED", error);
    }
  }

  @ReactMethod
  public void getPendingSyncCount(Promise promise) {
    try {
      promise.resolve(TrackingStore.getPendingSyncCount(context));
    } catch (Exception error) {
      promise.reject("PENDING_SYNC_COUNT_FAILED", error);
    }
  }

  @ReactMethod
  public void scheduleBackgroundTracking(Promise promise) {
    try {
      promise.resolve(TrackingScheduler.scheduleCollection(context));
    } catch (Exception error) {
      promise.reject("SCHEDULE_TRACKING_FAILED", error);
    }
  }

  @ReactMethod
  public void scheduleBackgroundSync(Promise promise) {
    try {
      promise.resolve(TrackingScheduler.scheduleSync(context));
    } catch (Exception error) {
      promise.reject("SCHEDULE_SYNC_FAILED", error);
    }
  }

  @ReactMethod
  public void cancelBackgroundSync(Promise promise) {
    try {
      TrackingScheduler.cancelSync(context);
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("CANCEL_SYNC_FAILED", error);
    }
  }

  @ReactMethod
  public void forceCollectUsage(Promise promise) {
    executor.execute(() -> {
      try {
        NativeActionResult result = TrackingStore.collectUsageSinceLastTimestamp(context);
        WritableMap payload = Arguments.createMap();
        payload.putBoolean("ok", result.getOk());
        payload.putString("message", result.getMessage());
        payload.putInt("collected", result.getCollected());
        payload.putInt("inserted", result.getInserted());
        payload.putInt("updated", result.getUpdated());
        payload.putInt("invalid", result.getInvalid());
        promise.resolve(payload);
      } catch (Exception error) {
        promise.reject("FORCE_COLLECT_FAILED", error);
      }
    });
  }

  @ReactMethod
  public void forceSyncUsage(Promise promise) {
    executor.execute(() -> {
      try {
        NativeActionResult result = TrackingStore.syncPendingUsage(context);
        WritableMap payload = Arguments.createMap();
        payload.putBoolean("ok", result.getOk());
        payload.putString("message", result.getMessage());
        payload.putInt("synced", result.getSynced());
        payload.putInt("duplicates", result.getDuplicates());
        payload.putInt("invalid", result.getInvalid());
        promise.resolve(payload);
      } catch (Exception error) {
        promise.reject("FORCE_SYNC_FAILED", error);
      }
    });
  }

  @ReactMethod
  public void cacheAuthState(String accessToken, String refreshToken, String userId, String deviceId, String apiBaseUrl, Promise promise) {
    try {
      TrackingStore.cacheAuthState(context, accessToken, refreshToken, userId, deviceId, apiBaseUrl);
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("CACHE_AUTH_FAILED", error);
    }
  }

  @ReactMethod
  public void clearAuthState(Promise promise) {
    try {
      TrackingStore.clearAuthState(context);
      promise.resolve(null);
    } catch (Exception error) {
      promise.reject("CLEAR_AUTH_FAILED", error);
    }
  }

  private String iconData(Drawable drawable) {
    if (drawable == null) return null;
    int size = 96;
    Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);
    drawable.setBounds(0, 0, size, size);
    drawable.draw(canvas);
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
    return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
  }
}
