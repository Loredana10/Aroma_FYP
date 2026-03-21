// app/_layout.tsx
import { AuthProvider, useAuth } from '@/contexts/auth_context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import * as Notifications from 'expo-notifications';
import { setupNotifications } from '@/services/notifications';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

function RouterStack() {
  const colorScheme       = useColorScheme();
  const { user, loading } = useAuth();
  const segments          = useSegments();
  const router            = useRouter();

  // useRef stores the subscription objects — .remove() is the correct
  // way to unsubscribe in expo-notifications SDK 54+
  const notifListenerRef    = useRef<{ remove: () => void } | null>(null);
  const responseListenerRef = useRef<{ remove: () => void } | null>(null);

  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  // ── Real-time Firestore listener for profile completion ───────────────────
  // Your existing onSnapshot approach — unchanged
  useEffect(() => {
    if (!user) {
      setProfileCompleted(null);
      setInitialCheckDone(true);
      return;
    }

    setInitialCheckDone(false);

    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfileCompleted(snap.data()?.profileCompleted ?? false);
        } else {
          setProfileCompleted(false);
        }
        setInitialCheckDone(true);
      },
      (error) => {
        console.error('Profile listener error:', error);
        setProfileCompleted(false);
        setInitialCheckDone(true);
      }
    );

    return unsub;
  }, [user?.uid]);

  // ── Auth navigation ───────────────────────────────────────────────────────
  // Your existing navigation logic — unchanged
  useEffect(() => {
    if (loading || !initialCheckDone) return;

    const inAuthGroup       = segments[0] === '(auth)';
    const onCompleteProfile = segments[segments.length - 1] === 'complete-profile';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/signin');
    } else if (user && profileCompleted === false && !onCompleteProfile) {
      router.replace('/(auth)/complete-profile');
    } else if (user && profileCompleted === true && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, profileCompleted, initialCheckDone, segments]);

  // ── Notification setup ────────────────────────────────────────────────────
  useEffect(() => {
    // Request permissions and schedule daily + weekly repeating notifications
    setupNotifications();

    // Foreground: fires when a notification arrives while app is open
    notifListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[Notifications] Received:', notification.request.content.title);
      }
    );

    // Background/closed: fires when the user taps a notification
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data   = response.notification.request.content.data as { screen?: string };
        const screen = data?.screen;
        if (screen) {
          try {
            router.push(screen as any);
          } catch {
            router.replace('/(tabs)');
          }
        }
      }
    );

    // Cleanup on unmount — SDK 54: call .remove() on the subscription object
    return () => {
      notifListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, []);

  if (loading || !initialCheckDone) {
    return (
      <View style={{
        flex: 1, justifyContent: 'center', alignItems: 'center',
        backgroundColor: colorScheme === 'dark' ? '#000' : '#fff',
      }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RouterStack />
    </AuthProvider>
  );
}