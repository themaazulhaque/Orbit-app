import { useEffect, useState, useCallback } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { colors } from '../src/theme';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { BrandedSplash } from '../src/components/BrandedSplash';
import { UpdateModal } from '../src/components/UpdateModal';
import { checkForUpdate, UpdateInfo } from '../src/services/updateService';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { isReady } = useAuth();
  const [showBrandedSplash, setShowBrandedSplash] = useState(true);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const performUpdateCheck = useCallback(async () => {
    try {
      const update = await checkForUpdate();
      if (update) {
        setUpdateInfo(update);
        setShowUpdateModal(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
      const timer = setTimeout(() => {
        setShowBrandedSplash(false);
        performUpdateCheck();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isReady, performUpdateCheck]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
          animationDuration: 200,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="app/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      </Stack>
      {showBrandedSplash && <BrandedSplash />}
      <UpdateModal
        visible={showUpdateModal}
        updateInfo={updateInfo}
        onDismiss={() => {
          setShowUpdateModal(false);
          setUpdateInfo(null);
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
