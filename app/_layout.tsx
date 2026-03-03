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
import { Colors } from '@/constants/theme';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

// Custom navigation themes using Aroma brown palette
const AromaLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary:    '#a67c52',
    background: '#fdf8f4',
    card:       '#ffffff',
    text:       '#2d1f12',
    border:     '#e8d5c0',
  },
};

const AromaDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary:    '#c09a70',
    background: '#2d1f12',
    card:       '#4a3320',
    text:       '#fdf8f4',
    border:     '#6f4e2e',
  },
};

function RouterStack() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const C = Colors[colorScheme ?? 'light'];

  useEffect(() => {
    if (!user) {
      setProfileCompleted(null);
      setInitialCheckDone(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (userDoc) => {
        const completed = userDoc.exists()
          ? userDoc.data()?.profileCompleted ?? true
          : true;
        setProfileCompleted(completed);
        setInitialCheckDone(true);
      },
      (error) => {
        console.error('Error watching profile:', error);
        setProfileCompleted(true);
        setInitialCheckDone(true);
      }
    );
    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (loading || !initialCheckDone) return;
    const inAuthGroup = segments[0] === '(auth)';
    const onCompleteProfile = segments[segments.length - 1] === 'complete-profile';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/signin');
    } else if (user && profileCompleted === false && !onCompleteProfile) {
      router.replace('/(auth)/complete-profile');
    } else if (user && profileCompleted === true && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, profileCompleted, initialCheckDone, segments]);

  if (loading || !initialCheckDone) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background }}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? AromaDarkTheme : AromaLightTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', headerShown: true, title: '' }}
        />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
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