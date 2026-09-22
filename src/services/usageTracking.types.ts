export type {
  AppUsageRecord,
  DailyUsageRecord,
  InstalledApp,
  UsageSnapshot,
  TrackingCapability,
  TrackingStatus,
  TrackingOperationResult,
} from '../types';

export interface ChronicleUsageNativeModule {
  isUsageAccessGranted(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  getInstallationId(): Promise<string>;
  getInstalledApps(): Promise<import('../types').InstalledApp[]>;
  getUsageStats(startTime: number, endTime: number): Promise<import('../types').AppUsageRecord[]>;
  getStoredUsageStats(startTime: number, endTime: number): Promise<import('../types').AppUsageRecord[]>;
  getTrackingStatus(): Promise<import('../types').TrackingStatus>;
  getLastCollectionTime(): Promise<number | null>;
  getPendingSyncCount(): Promise<number>;
  scheduleBackgroundTracking(): Promise<boolean>;
  scheduleBackgroundSync(): Promise<boolean>;
  cancelBackgroundSync(): Promise<void>;
  forceCollectUsage(): Promise<import('../types').TrackingOperationResult>;
  forceSyncUsage(): Promise<import('../types').TrackingOperationResult>;
  cacheAuthState(accessToken: string, refreshToken: string, userId: string, deviceId: string, apiBaseUrl: string): Promise<void>;
  clearAuthState(): Promise<void>;
}
