import * as SecureStore from 'expo-secure-store';
import { NativeModules, Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://chronicle-backend-gvy4.onrender.com/api/v1';
const nativeTrackingModule = NativeModules.ChronicleUsageModule as
  | {
      cacheAuthState?: (accessToken: string, refreshToken: string, userId: string, deviceId: string, apiBaseUrl: string) => Promise<void>;
      clearAuthState?: () => Promise<void>;
      scheduleBackgroundSync?: () => Promise<boolean>;
      cancelBackgroundSync?: () => Promise<void>;
    }
  | undefined;

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync('chronicle_access_token');
}

async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync('chronicle_refresh_token');
}

async function syncNativeAuthState(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeTrackingModule?.cacheAuthState) return;

  const [accessToken, refreshToken, userId, deviceId] = await Promise.all([
    getAccessToken(),
    getRefreshToken(),
    getStoredUserId(),
    getStoredDeviceId(),
  ]);

  if (!accessToken || !refreshToken || !userId || !deviceId) return;

  try {
    await nativeTrackingModule.cacheAuthState(accessToken, refreshToken, userId, deviceId, API_URL);
    if (nativeTrackingModule.scheduleBackgroundSync) {
      await nativeTrackingModule.scheduleBackgroundSync();
    }
  } catch {
    return;
  }
}

async function clearNativeAuthState(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeTrackingModule?.clearAuthState) return;
  try {
    await nativeTrackingModule.clearAuthState();
    if (nativeTrackingModule.cancelBackgroundSync) {
      await nativeTrackingModule.cancelBackgroundSync();
    }
  } catch {
    return;
  }
}

export async function storeTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync('chronicle_access_token', access);
  await SecureStore.setItemAsync('chronicle_refresh_token', refresh);
  await syncNativeAuthState();
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync('chronicle_access_token');
  await SecureStore.deleteItemAsync('chronicle_refresh_token');
  await SecureStore.deleteItemAsync('chronicle_user_id');
  await clearNativeAuthState();
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${API_URL}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    await storeTokens(data.access, data.refresh || refreshToken);
    return data.access;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_URL}${path}`;
  const accessToken = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    console.log(`[API] ${options.method || 'GET'} ${url}`);
    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && accessToken) {
      console.log('[API] Token expired, attempting refresh...');
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }

    const text = await response.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorMsg = data && typeof data === 'object' && 'detail' in data
        ? (data as Record<string, string>).detail
        : `HTTP ${response.status}`;
      console.log(`[API] Error: ${errorMsg}`);
      return { ok: false, status: response.status, data: null, error: errorMsg };
    }

    console.log(`[API] Success: ${response.status}`);
    return { ok: true, status: response.status, data, error: null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.log(`[API] Network error: ${msg}`);
    return { ok: false, status: 0, data: null, error: msg };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

export async function getStoredUserId(): Promise<string | null> {
  return SecureStore.getItemAsync('chronicle_user_id');
}

export async function storeUserId(id: string): Promise<void> {
  await SecureStore.setItemAsync('chronicle_user_id', id);
  await syncNativeAuthState();
}

export async function getStoredDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync('chronicle_device_id');
}

export async function storeDeviceId(id: string): Promise<void> {
  await SecureStore.setItemAsync('chronicle_device_id', id);
  await syncNativeAuthState();
}
