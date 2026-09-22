import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { isAuthenticated, getStoredUserId, registerDevice, apiRequest, onAuthSessionExpired } from '../services/api';
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

  const setLoggedOut = useCallback((sessionExpired: boolean): void => {
    setState(prev => ({
      ...prev,
      isReady: true,
      isLoggedIn: false,
      sessionExpired,
      userId: null,
      deviceId: null,
    }));
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const authed = await isAuthenticated();
      if (authed) {
        const userId = await getStoredUserId();
        const meResult = await apiRequest<AuthUser>('/auth/me/');
        if (meResult.kind === 'auth') {
          setLoggedOut(true);
          return;
        }
        if (meResult.ok && meResult.data) {
          const currentUser = meResult.data;
          const deviceResult = await registerDevice();
          await usageTrackingService.ensureBackgroundTrackingScheduled();
          setState(prev => ({
            ...prev,
            isReady: true,
            isLoggedIn: true,
            sessionExpired: false,
            userId: currentUser.id,
            deviceId: deviceResult.deviceId || null,
          }));
          return;
        }
        setState(prev => ({
          ...prev,
          isReady: true,
          isLoggedIn: true,
          sessionExpired: false,
          userId,
          deviceId: prev.deviceId,
        }));
      } else {
        setLoggedOut(false);
      }
    } catch {
      setLoggedOut(true);
    }
  }, [setLoggedOut]);

  useEffect(() => {
    const unsubscribe = onAuthSessionExpired(() => {
      setLoggedOut(true);
    });
    refreshAuth();
    return unsubscribe;
  }, [refreshAuth, setLoggedOut]);

  return (
    <AuthContext.Provider value={{ ...state, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
