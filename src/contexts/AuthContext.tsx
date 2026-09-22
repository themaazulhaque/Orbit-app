import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getStoredUserId, getStoredDeviceId, registerDevice, apiRequest, bootstrapSession, onAuthSessionExpired } from '../services/api';
import { usageTrackingService } from '../services/usageTrackingService';
import type { AuthUser } from '../services/api/auth';

interface AuthState {
  isReady: boolean;
  isLoggedIn: boolean;
  sessionExpired: boolean;
  userId: string | null;
  deviceId: string | null;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isReady: false,
  isLoggedIn: false,
  sessionExpired: false,
  userId: null,
  deviceId: null,
  refreshAuth: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isReady: false,
    isLoggedIn: false,
    sessionExpired: false,
    userId: null,
    deviceId: null,
    refreshAuth: async () => {},
  });

  const setLoggedIn = useCallback((userId: string | null, deviceId: string | null): void => {
    setState(prev => ({
      ...prev,
      isReady: true,
      isLoggedIn: true,
      sessionExpired: false,
      userId,
      deviceId: deviceId ?? prev.deviceId,
    }));
  }, []);

  const setUnavailable = useCallback((): void => {
    setState(prev => ({
      ...prev,
      isReady: true,
      isLoggedIn: false,
      sessionExpired: false,
    }));
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      let meResult = await apiRequest<AuthUser>('/auth/me/');
      if (meResult.kind === 'auth') {
        console.log('[AUTH] Session validation failed; bootstrapping automatic session');
        const boot = await bootstrapSession();
        if (boot.ok) {
          meResult = await apiRequest<AuthUser>('/auth/me/');
        } else {
          if (boot.kind === 'network') {
            const storedUserId = await getStoredUserId();
            const storedDeviceId = await getStoredDeviceId();
            setLoggedIn(storedUserId, storedDeviceId);
            return;
          }
          setUnavailable();
          return;
        }
      }
      if (meResult.ok && meResult.data) {
        const currentUser = meResult.data;
        const deviceResult = await registerDevice();
        await usageTrackingService.ensureBackgroundTrackingScheduled();
        setLoggedIn(currentUser.id, deviceResult.deviceId || null);
        return;
      }
      if (meResult.kind === 'network') {
        const storedUserId = await getStoredUserId();
        const storedDeviceId = await getStoredDeviceId();
        setLoggedIn(storedUserId, storedDeviceId);
        return;
      }
      const storedUserId = await getStoredUserId();
      const storedDeviceId = await getStoredDeviceId();
      setLoggedIn(storedUserId, storedDeviceId);
    } catch {
      setUnavailable();
    }
  }, [setLoggedIn, setUnavailable]);

  useEffect(() => {
    const unsubscribe = onAuthSessionExpired(() => {
      refreshAuth();
    });
    refreshAuth();
    return unsubscribe;
  }, [refreshAuth]);

  return (
    <AuthContext.Provider value={{ ...state, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
