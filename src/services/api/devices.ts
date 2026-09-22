import { apiRequest, getStoredDeviceId, storeDeviceId, getStoredDeviceIdentifier, storeDeviceIdentifier, getOrCreateInstallationId } from './client';
import * as Device from 'expo-device';
import type { ApiResponseKind } from './client';

export interface BackendDevice {
  id: string;
  device_name: string;
  device_identifier: string;
  android_version: string;
  app_version: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeviceListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: BackendDevice[];
}

export interface RegisterDeviceResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
  kind?: ApiResponseKind;
}

async function buildDeviceIdentifier(): Promise<string> {
  const brand = Device.brand || 'unknown';
  const model = Device.modelName || Device.modelId || 'android';
  const installationId = await getOrCreateInstallationId();
  return `chronicle-${brand}-${model}-${installationId}`;
}

async function createDevice(deviceIdentifier: string): Promise<RegisterDeviceResult> {
  const brand = Device.brand || 'unknown';
  const model = Device.modelName || Device.modelId || 'android';

  const result = await apiRequest<BackendDevice>('/devices/', {
    method: 'POST',
    body: JSON.stringify({
      device_name: `${brand} ${model}`,
      device_identifier: deviceIdentifier,
      android_version: Device.osVersion || '',
      app_version: '1.1.0',
    }),
  });

  if (!result.ok) return { ok: false, kind: result.kind, error: result.error || 'Device registration failed' };
  if (result.data) {
    await storeDeviceId(result.data.id);
    await storeDeviceIdentifier(deviceIdentifier);
    console.log(`[DEVICE] Registered: ${result.data.id}`);
    return { ok: true, deviceId: result.data.id, kind: 'success' };
  }
  return { ok: false, kind: 'api', error: 'No data returned' };
}

export async function registerDevice(): Promise<RegisterDeviceResult> {
  const existingDeviceId = await getStoredDeviceId();
  const existingIdentifier = await getStoredDeviceIdentifier();

  if (existingDeviceId) {
    const listResult = await apiRequest<DeviceListResponse>('/devices/');
    const devices = listResult.data?.results;
    if (listResult.ok && Array.isArray(devices)) {
      const matched = devices.find(device => device.id === existingDeviceId);
      if (matched) {
        await storeDeviceId(existingDeviceId);
        console.log(`[DEVICE] Reconciled existing device: ${existingDeviceId}`);
        return { ok: true, deviceId: existingDeviceId, kind: 'success' };
      }
      console.log(`[DEVICE] Stored device ${existingDeviceId} not found on server; re-registering`);
    } else if (listResult.kind === 'network' || listResult.kind === 'auth') {
      return {
        ok: true,
        deviceId: existingDeviceId,
        kind: listResult.kind,
        error: listResult.error || 'Unable to verify device registration',
      };
    }
  }

  const deviceIdentifier = existingIdentifier || (await buildDeviceIdentifier());
  return createDevice(deviceIdentifier);
}