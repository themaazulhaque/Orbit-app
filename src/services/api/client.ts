import * as SecureStore from 'expo-secure-store';
import { NativeModules, Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://chronicle-backend-gvy4.onrender.com/api/v1';
const nativeTrackingModule = NativeModules.ChronicleUsageModule as
  | {
      cacheAuthState?: (accessToken: string, refreshToken: string, userId: string, deviceId: string, apiBaseUrl: string) => Promise<void>;
      clearAuthState?: () => Promise<void>;
      scheduleBackgroundSync?: () => Promise<boolean>;
      cancelBackgroundSync?: () => Promise<void>;
      getInstallationId?: () => Promise<string>;
    }
  | undefined;

export type ApiResponseKind = 'success' | 'auth' | 'network' | 'api';

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  kind: ApiResponseKind;
}

const REQUEST_TIMEOUT_MS = 20000;
const REFRESH_TIMEOUT_MS = 15000;
const INSTALLATION_ID_KEY = 'chronicle_installation_id';

interface RefreshResult {
  ok: boolean;
  access?: string;
  transitory: boolean;
}

export interface BootstrapResult {
  ok: boolean;
  access?: string;
  error?: string;
  kind: ApiResponseKind;
}

let refreshInFlight: Promise<RefreshResult> | null = null;
let bootstrapInFlight: Promise<BootstrapResult> | null = null;
let sessionCleared = false;

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

export function onAuthSessionExpired(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function markSessionUnrecoverable(): Promise<void> {
  if (sessionCleared) return;
  sessionCleared = true;
  await clearTokens();
  authFailureListeners.forEach(listener => {
    try {
      listener();
    } catch {
      return;
    }
  });
}

async function generateInstallationId(): Promise<string> {
  const randomPart = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `inst-${randomPart}`;
}

export async function getOrCreateInstallationId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (stored) return stored;

  if (Platform.OS === 'android' && nativeTrackingModule?.getInstallationId) {
    try {
      const nativeId = await nativeTrackingModule.getInstallationId();
      if (nativeId && nativeId.length >= 16) {
        await SecureStore.setItemAsync(INSTALLATION_ID_KEY, nativeId);
        return nativeId;
      }
    } catch {
      // fall through to JS-generated id
    }
  }

  const fallback = await generateInstallationId();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, fallback);
  return fallback;
}

async function doBootstrapSession(): Promise<BootstrapResult> {
  try {
    const installationId = await getOrCreateInstallationId();
    console.log('[AUTH] Bootstrapping session with installation identity');
    const response = await fetchWithTimeout(
      `${API_URL}/auth/bootstrap/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (response.status === 200 || response.status === 201) {
      const data = await response.json();
      const access: string | undefined = data?.access;
      const refresh: string | undefined = data?.refresh;
      const userId: string | undefined = data?.user?.id;
      if (!access || !refresh || !userId) return { ok: false, kind: 'api', error: 'Bootstrap response was missing token fields.' };
      await storeTokens(access, refresh);
      await storeUserId(userId);
      console.log('[AUTH] Bootstrap session established');
      return { ok: true, access, kind: 'success' };
    }
    console.log(`[AUTH] Bootstrap rejected with HTTP ${response.status}`);
    return { ok: false, kind: 'api', error: `Bootstrap failed (HTTP ${response.status}).` };
  } catch (error) {
    console.log('[AUTH] Bootstrap failed due to network error');
    return { ok: false, kind: 'network', error: 'No internet connection. Please try again.' };
  }
}

export function bootstrapSession(): Promise<BootstrapResult> {
  if (!bootstrapInFlight) {
    bootstrapInFlight = doBootstrapSession().finally(() => {
      bootstrapInFlight = null;
    });
  }
  return bootstrapInFlight;
}

async function ensureSession(): Promise<BootstrapResult> {
  const accessToken = await getAccessToken();
  if (accessToken) return { ok: true, access: accessToken, kind: 'success' };
  return bootstrapSession();
}

async function doRefreshTokens(): Promise<RefreshResult> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    const boot = await ensureSession();
    if (boot.ok && boot.access) return { ok: true, access: boot.access, transitory: false };
    return { ok: false, transitory: boot.kind === 'network' };
  }
  try {
    const response = await fetchWithTimeout(
      `${API_URL}/auth/refresh/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: refreshToken }),
      },
      REFRESH_TIMEOUT_MS,
    );
    if (response.status === 200) {
      const data = await response.json();
      const access: string | undefined = data?.access;
      if (!access) return { ok: false, transitory: true };
      await storeTokens(access, typeof data?.refresh === 'string' ? data.refresh : refreshToken);
      return { ok: true, access, transitory: false };
    }
    if (response.status === 400 || response.status === 401) {
      console.log('[AUTH] Refresh token rejected; re-bootstrapping automatically');
      const boot = await ensureSession();
      if (boot.ok && boot.access) return { ok: true, access: boot.access, transitory: false };
      await markSessionUnrecoverable();
      return { ok: false, transitory: boot.kind === 'network' };
    }
    console.log(`[AUTH] Refresh returned ${response.status}; treating as transient`);
    return { ok: false, transitory: true };
  } catch (error) {
    console.log('[AUTH] Refresh failed due to network error');
    return { ok: false, transitory: true };
  }
}

function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
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
  sessionCleared = false;
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

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_URL}${path}`;
  let accessToken = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!accessToken) {
    console.log('[API] No access token; bootstrapping automatic session');
    const boot = await bootstrapSession();
    if (boot.ok && boot.access) {
      accessToken = boot.access;
    } else if (boot.kind === 'network') {
      console.log('[API] Bootstrap failed due to network issue');
      return { ok: false, status: 0, data: null, error: 'No internet connection. Please try again.', kind: 'network' };
    } else {
      console.log('[API] Bootstrap failed');
      return { ok: false, status: 401, data: null, error: 'Could not restore your session. Please try again.', kind: 'auth' };
    }
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    console.log(`[API] ${options.method || 'GET'} ${url}`);
    let response = await fetchWithTimeout(url, { ...options, headers }, REQUEST_TIMEOUT_MS);

    if (response.status === 401 && accessToken) {
      console.log('[API] Token expired, attempting refresh...');
      const refreshResult = await refreshAccessToken();
      if (refreshResult.ok && refreshResult.access) {
        headers['Authorization'] = `Bearer ${refreshResult.access}`;
        response = await fetchWithTimeout(url, { ...options, headers }, REQUEST_TIMEOUT_MS);
        if (response.status === 401) {
          console.log('[API] Fresh token still rejected; re-bootstrapping session and retrying once');
          const boot = await bootstrapSession();
          if (boot.ok && boot.access) {
            headers['Authorization'] = `Bearer ${boot.access}`;
            response = await fetchWithTimeout(url, { ...options, headers }, REQUEST_TIMEOUT_MS);
            if (response.status === 401) {
              console.log('[API] Request still rejected after recovery');
              return { ok: false, status: 401, data: null, error: 'Your session could not be verified. Please try again.', kind: 'auth' };
            }
          } else {
            if (boot.kind === 'network') {
              return { ok: false, status: 0, data: null, error: 'No internet connection. Please try again.', kind: 'network' };
            }
            return { ok: false, status: 401, data: null, error: 'Could not restore your session. Please try again.', kind: 'auth' };
          }
        }
      } else if (!refreshResult.transitory) {
        console.log('[API] Session unrecoverable after failed refresh');
        return { ok: false, status: 401, data: null, error: 'Could not restore your session. Please try again.', kind: 'auth' };
      } else {
        console.log('[API] Refresh failed due to network issue');
        return { ok: false, status: 0, data: null, error: 'No internet connection. Please try again.', kind: 'network' };
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
      const kind: ApiResponseKind = response.status === 401 ? 'auth' : 'api';
      console.log(`[API] Error: ${errorMsg}`);
      return { ok: false, status: response.status, data: null, error: errorMsg, kind };
    }

    console.log(`[API] Success: ${response.status}`);
    return { ok: true, status: response.status, data, error: null, kind: 'success' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.log(`[API] Network error: ${msg}`);
    return { ok: false, status: 0, data: null, error: 'No internet connection. Please try again.', kind: 'network' };
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

export async function getStoredDeviceIdentifier(): Promise<string | null> {
  return SecureStore.getItemAsync('chronicle_device_identifier');
}

export async function storeDeviceIdentifier(identifier: string): Promise<void> {
  await SecureStore.setItemAsync('chronicle_device_identifier', identifier);
}

export async function refreshNativeAuthState(): Promise<void> {
  await syncNativeAuthState();
}
