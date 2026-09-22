import { usageTrackingService } from './usageTrackingService';
import { registerDevice, refreshNativeAuthState } from './api';
import { TrackingOperationResult } from '../types';

export interface SyncStatus {
  lastSyncAt: string | null;
  isSyncing: boolean;
  lastSyncResult: string | null;
}

let syncStatusListeners: ((status: SyncStatus) => void)[] = [];
let currentStatus: SyncStatus = { lastSyncAt: null, isSyncing: false, lastSyncResult: null };

function notifyListeners() {
  syncStatusListeners.forEach(cb => cb({ ...currentStatus }));
}

function toMessage(result: TrackingOperationResult, fallback: string): string {
  return result.message || fallback;
}

function indicatesDeviceMissing(message: string | undefined | null): boolean {
  const text = (message || '').toLowerCase();
  return text.includes('device is not registered') || text.includes('device not found') || text.includes('not owned');
}

export const usageSyncService = {
  getStatus(): SyncStatus {
    return { ...currentStatus };
  },

  onStatusChange(callback: (status: SyncStatus) => void): () => void {
    syncStatusListeners.push(callback);
    return () => {
      syncStatusListeners = syncStatusListeners.filter(cb => cb !== callback);
    };
  },

  async syncNow(): Promise<{ ok: boolean; message: string }> {
    if (usageTrackingService.isExpoGo()) {
      return { ok: false, message: 'Sync requires a development build.' };
    }

    if (!usageTrackingService.hasNativeModule()) {
      return { ok: false, message: 'Native tracking module unavailable.' };
    }

    const hasPermission = await usageTrackingService.isUsageAccessGranted();
    if (!hasPermission) {
      return { ok: false, message: 'Usage access permission is not granted.' };
    }

    currentStatus = { ...currentStatus, isSyncing: true, lastSyncResult: null };
    notifyListeners();

    try {
      const registration = await registerDevice();
      if (!registration.ok || !registration.deviceId) {
        const message = registration.kind === 'network'
          ? 'No internet connection. Please check your connection and try again.'
          : registration.kind === 'auth'
            ? 'Session could not be restored. Please try again.'
            : (registration.error || 'Device registration failed.');
        currentStatus = { ...currentStatus, isSyncing: false, lastSyncResult: message };
        notifyListeners();
        return { ok: false, message };
      }
      await refreshNativeAuthState();

      const collectResult = await usageTrackingService.forceCollectUsage();
      if (!collectResult.ok) {
        currentStatus = { ...currentStatus, isSyncing: false, lastSyncResult: collectResult.message };
        notifyListeners();
        return { ok: false, message: collectResult.message };
      }

      let syncResult = await usageTrackingService.forceSyncUsage();

      if (!syncResult.ok && indicatesDeviceMissing(syncResult.message)) {
        console.log(`[SYNC] Device rejected (${syncResult.message}); re-registering and retrying once`);
        const reReg = await registerDevice();
        if (reReg.ok && reReg.deviceId) {
          await refreshNativeAuthState();
          syncResult = await usageTrackingService.forceSyncUsage();
        }
      }

      if (syncResult.ok) {
        const now = new Date().toISOString();
        currentStatus = {
          lastSyncAt: now,
          isSyncing: false,
          lastSyncResult: toMessage(syncResult, `Synced ${syncResult.synced || 0} records`),
        };
        notifyListeners();
        return { ok: true, message: syncResult.message || `Synced ${syncResult.synced || 0} records` };
      }

      const message = toMessage(syncResult, 'Sync failed');
      currentStatus = { ...currentStatus, isSyncing: false, lastSyncResult: message };
      notifyListeners();
      return { ok: false, message };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sync error';
      currentStatus = { ...currentStatus, isSyncing: false, lastSyncResult: msg };
      notifyListeners();
      return { ok: false, message: msg };
    }
  },
};
