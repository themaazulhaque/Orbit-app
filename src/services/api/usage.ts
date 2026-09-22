import { apiRequest, getStoredDeviceId } from './client';
import { registerDevice } from './devices';

export interface SyncSession {
  package_name: string;
  app_name: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
}

export interface SyncResult {
  created: number;
  duplicates: number;
  invalid: number;
}

export interface ActivitySession {
  id: string;
  app_name: string;
  package_name: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
}

export interface ActivityResponse {
  date: string;
  sessions: ActivitySession[];
}

async function postSyncUsage(deviceId: string, sessions: SyncSession[]) {
  return apiRequest<SyncResult>('/usage/sync/', {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId, sessions }),
  });
}

export async function syncUsage(sessions: SyncSession[]): Promise<{ ok: boolean; result?: SyncResult; error?: string }> {
  if (sessions.length === 0) return { ok: true, result: { created: 0, duplicates: 0, invalid: 0 } };

  let deviceId = await getStoredDeviceId();
  if (!deviceId) {
    const reg = await registerDevice();
    if (!reg.ok || !reg.deviceId) {
      return { ok: false, error: reg.error || 'Device not registered' };
    }
    deviceId = reg.deviceId;
  }

  console.log(`[SYNC] Starting sync: ${sessions.length} sessions for device ${deviceId}`);
  let result = await postSyncUsage(deviceId, sessions);

  if (!result.ok && result.status === 400) {
    console.log('[SYNC] Sync rejected by server; reconciling device and retrying once');
    const reg = await registerDevice();
    if (reg.ok && reg.deviceId) {
      deviceId = reg.deviceId;
      result = await postSyncUsage(deviceId, sessions);
    }
  }

  if (!result.ok) {
    console.log(`[SYNC] Failed: ${result.error}`);
    return { ok: false, error: result.error || 'Sync failed' };
  }

  console.log(`[SYNC] Success: created=${result.data?.created}, duplicates=${result.data?.duplicates}`);
  return { ok: true, result: result.data || undefined };
}

export async function getActivity(date: string): Promise<{ ok: boolean; sessions?: ActivitySession[]; error?: string }> {
  const result = await apiRequest<ActivityResponse>(`/usage/activity/?date=${date}`);
  if (!result.ok) return { ok: false, error: result.error || 'Failed to fetch activity' };
  return { ok: true, sessions: result.data?.sessions || [] };
}
