import Constants from 'expo-constants';
import { AppState, NativeModules, Platform } from 'react-native';
import {
  AppInfo,
  AppUsageRecord,
  DailyUsageRecord,
  InstalledApp,
  TrackingOperationResult,
  TrackingStatus,
  UsageSnapshot,
} from '../types';
import { getDateKey } from '../utils/formatting';
import type { ChronicleUsageNativeModule } from './usageTracking.types';

const nativeModule = NativeModules.ChronicleUsageModule as ChronicleUsageNativeModule | undefined;

const fallbackTrackingStatus: TrackingStatus = {
  usageAccessGranted: false,
  collectionScheduled: false,
  syncScheduled: false,
  trackingActive: false,
  networkAvailable: false,
  authenticated: false,
  deviceId: null,
  lastCollectionAt: null,
  lastSyncAt: null,
  pendingSyncCount: 0,
};

export const usageTrackingService = {
  isExpoGo(): boolean {
    return Constants.executionEnvironment === 'storeClient';
  },

  getRuntimeMode(): 'Expo Go' | 'Development Build' | 'Standalone APK' | 'Unsupported' {
    if (this.isExpoGo()) return 'Expo Go';
    if (Platform.OS !== 'android') return 'Unsupported';
    return Constants.executionEnvironment === 'standalone' ? 'Standalone APK' : 'Development Build';
  },

  hasNativeModule(): boolean {
    return Platform.OS === 'android' && !!nativeModule;
  },

  async isUsageAccessGranted(): Promise<boolean> {
    if (!this.hasNativeModule()) return false;
    return nativeModule!.isUsageAccessGranted();
  },

  async getInstallationId(): Promise<string | null> {
    if (!this.hasNativeModule() || this.isExpoGo()) return null;
    try {
      return await nativeModule!.getInstallationId();
    } catch {
      return null;
    }
  },

  async openUsageAccessSettings(): Promise<void> {
    if (this.hasNativeModule()) await nativeModule!.openUsageAccessSettings();
  },

  async getTrackingStatus(): Promise<TrackingStatus> {
    if (!this.hasNativeModule() || this.isExpoGo()) {
      return fallbackTrackingStatus;
    }

    try {
      return await nativeModule!.getTrackingStatus();
    } catch {
      return fallbackTrackingStatus;
    }
  },

  async getLastCollectionTime(): Promise<number | null> {
    if (!this.hasNativeModule() || this.isExpoGo()) return null;
    try {
      return await nativeModule!.getLastCollectionTime();
    } catch {
      return null;
    }
  },

  async getPendingSyncCount(): Promise<number> {
    if (!this.hasNativeModule() || this.isExpoGo()) return 0;
    try {
      return await nativeModule!.getPendingSyncCount();
    } catch {
      return 0;
    }
  },

  async scheduleBackgroundTracking(): Promise<boolean> {
    if (!this.hasNativeModule() || this.isExpoGo()) return false;
    try {
      return await nativeModule!.scheduleBackgroundTracking();
    } catch {
      return false;
    }
  },

  async scheduleBackgroundSync(): Promise<boolean> {
    if (!this.hasNativeModule() || this.isExpoGo()) return false;
    try {
      return await nativeModule!.scheduleBackgroundSync();
    } catch {
      return false;
    }
  },

  async cancelBackgroundSync(): Promise<void> {
    if (!this.hasNativeModule() || this.isExpoGo()) return;
    try {
      await nativeModule!.cancelBackgroundSync();
    } catch {
      return;
    }
  },

  async ensureBackgroundTrackingScheduled(): Promise<void> {
    if (this.isExpoGo() || !this.hasNativeModule()) return;
    const granted = await this.isUsageAccessGranted();
    if (!granted) return;
    await this.scheduleBackgroundTracking();
    await this.scheduleBackgroundSync();
  },

  async forceCollectUsage(): Promise<TrackingOperationResult> {
    if (!this.hasNativeModule() || this.isExpoGo()) {
      return { ok: false, message: 'Native tracking is unavailable.' };
    }
    return nativeModule!.forceCollectUsage();
  },

  async forceSyncUsage(): Promise<TrackingOperationResult> {
    if (!this.hasNativeModule() || this.isExpoGo()) {
      return { ok: false, message: 'Native tracking is unavailable.' };
    }
    return nativeModule!.forceSyncUsage();
  },

  async getSnapshot(date = new Date()): Promise<UsageSnapshot> {
    const now = Date.now();
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const end = date > new Date() ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() : now;

    if (this.isExpoGo()) {
      return { capability: 'expo-go', canReadUsage: false, usageRecords: [], installedApps: [], queriedAt: now, startTime: start, endTime: end, error: 'Real Android usage tracking requires the Orbit development build.' };
    }
    if (!this.hasNativeModule()) {
      return { capability: 'native-module-unavailable', canReadUsage: false, usageRecords: [], installedApps: [], queriedAt: now, startTime: start, endTime: end, error: 'Usage tracking module is unavailable in this build.' };
    }

    try {
      const granted = await this.isUsageAccessGranted();
      const isToday = getDateKey(date) === getDateKey(new Date());
      if (!granted && isToday) {
        return { capability: 'permission-required', canReadUsage: false, usageRecords: [], installedApps: [], queriedAt: now, startTime: start, endTime: end };
      }

      const installedApps = await nativeModule!.getInstalledApps();

      const storedUsageRecords = await nativeModule!.getStoredUsageStats(start, end);

      let usageRecords: AppUsageRecord[] = storedUsageRecords;

      if (isToday && granted) {
        const liveUsageRecords = await nativeModule!.getUsageStats(start, end);
        const storedByPackage = new Map(storedUsageRecords.map(r => [r.packageName, r]));
        for (const live of liveUsageRecords) {
          const existing = storedByPackage.get(live.packageName);
          if (!existing || live.lastTimeUsed > existing.lastTimeUsed) {
            storedByPackage.set(live.packageName, live);
          } else if (existing && live.totalTimeInForeground > existing.totalTimeInForeground) {
            storedByPackage.set(live.packageName, live);
          }
        }
        usageRecords = Array.from(storedByPackage.values());
      }

      console.log('[Orbit Tracking] Snapshot', { queriedAt: now, records: usageRecords.length, installedApps: installedApps.length });
      return { capability: usageRecords.length ? 'available' : 'no-data', canReadUsage: granted, usageRecords, installedApps, queriedAt: now, startTime: start, endTime: end };
    } catch (error) {
      return { capability: 'native-module-unavailable', canReadUsage: false, usageRecords: [], installedApps: [], queriedAt: now, startTime: start, endTime: end, error: error instanceof Error ? error.message : 'Unable to read Android usage data.' };
    }
  },

  async getApps(): Promise<{ apps: AppInfo[]; snapshot: UsageSnapshot }> {
    const snapshot = await this.getSnapshot();
    const usageByPackage = new Map(snapshot.usageRecords.map(record => [record.packageName, record]));
    const apps = snapshot.installedApps.map(app => {
      const record = usageByPackage.get(app.packageName);
      const dailyUsage: DailyUsageRecord[] = record ? [{ date: getDateKey(new Date()), totalTimeInForeground: record.totalTimeInForeground, lastTimeUsed: record.lastTimeUsed }] : [];
      return toAppInfo(app, dailyUsage);
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { apps, snapshot };
  },

  async getAppById(id: string): Promise<{ app?: AppInfo; snapshot: UsageSnapshot }> {
    const result = await this.getApps();
    return { app: result.apps.find(app => app.id === id || app.packageName === id), snapshot: result.snapshot };
  },

  async getHistoricalUsage(packageName: string, days = 7): Promise<DailyUsageRecord[]> {
    if (!this.hasNativeModule() || this.isExpoGo()) return [];
    const records: DailyUsageRecord[] = [];
    const now = new Date();
    for (let offset = 0; offset < days; offset += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const start = day.getTime();
      const end = offset === 0 ? Date.now() : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      const usage = await nativeModule!.getStoredUsageStats(start, end);
      const record = usage.find(item => item.packageName === packageName);
      if (record && record.totalTimeInForeground > 0) {
        records.push({ date: getDateKey(day), totalTimeInForeground: record.totalTimeInForeground, lastTimeUsed: record.lastTimeUsed });
      }
    }
    return records;
  },

  subscribeToForeground(callback: () => void): () => void {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') callback(); });
    return () => subscription.remove();
  },
};

function toAppInfo(app: InstalledApp, dailyUsage: DailyUsageRecord[]): AppInfo {
  const today = dailyUsage[0];
  return { id: app.packageName, name: app.appName, packageName: app.packageName, category: 'unknown', icon: app.icon, todayUsageMinutes: today ? Math.round(today.totalTimeInForeground / 60000) : 0, weeklyUsageMinutes: today ? Math.round(today.totalTimeInForeground / 60000) : 0, lastOpened: today?.lastTimeUsed ? new Date(today.lastTimeUsed) : undefined, dailyUsage };
}
