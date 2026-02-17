import { AuthProvider, useAuth } from '@/contexts/auth_context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import { doc, getDoc } from 'firebase/firestore';
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

  // Check profile completion status only once when user changes
  useEffect(() => {
    const checkProfile = async () => {
      if (!user) {
        setProfileCompleted(null);
        setInitialCheckDone(true);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const completed = userDoc.exists() ? userDoc.data()?.profileCompleted ?? true : true;
        setProfileCompleted(completed);
      } catch (error) {
        console.error('Error checking profile:', error);
        setProfileCompleted(true); // Default to true on error
      } finally {
        setInitialCheckDone(true);
      }
    };

    checkProfile();
  }, [user?.uid]); // Only re-run when user ID changes

  // Handle navigation based on auth and profile status
  useEffect(() => {
    if (loading || !initialCheckDone) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onCompleteProfile = segments[segments.length - 1] === 'complete-profile';

    if (!user && !inAuthGroup) {
      // Not logged in - go to sign in
      router.replace('/(auth)/signin');
    } else if (user && profileCompleted === false && !onCompleteProfile) {
      // Logged in but profile incomplete - go to complete profile
      router.replace('/(auth)/complete-profile');
    } else if (user && profileCompleted === true && inAuthGroup && !onCompleteProfile) {
      // Logged in with complete profile but in auth section - go to app
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