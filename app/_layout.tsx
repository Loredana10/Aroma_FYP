import { AuthProvider, useAuth } from '@/contexts/auth_context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebaseConfig';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

function RouterStack() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  // Use a real-time Firestore listener so when complete-profile writes
  // profileCompleted: true, this layout immediately sees it and can act
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
          // Doc not written yet (race condition on signup) — default to incomplete
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

    return unsub; // Unsubscribe when user changes
  }, [user?.uid]);

  // Handle navigation — only redirect, never interfere while on complete-profile
  useEffect(() => {
    if (loading || !initialCheckDone) return;

    const inAuthGroup        = segments[0] === '(auth)';
    const onCompleteProfile  = segments[segments.length - 1] === 'complete-profile';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/signin');
    } else if (user && profileCompleted === false && !onCompleteProfile) {
      // Only push to complete-profile if not already there
      router.replace('/(auth)/complete-profile');
    } else if (user && profileCompleted === true && inAuthGroup) {
      // Profile is done — move to app (this fires automatically when
      // complete-profile writes profileCompleted: true to Firestore)
      router.replace('/(tabs)');
    }
  }, [user, loading, profileCompleted, initialCheckDone, segments]);

  if (loading || !initialCheckDone) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }}>
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