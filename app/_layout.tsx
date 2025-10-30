import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/contexts/auth_context';
import { View, ActivityIndicator } from 'react-native';

export const unstable_settings = {
  // We’ll navigate conditionally; still keep tabs anchor for routes
  anchor: '(tabs)',
};

function RouterStack() {
  const colorScheme = useColorScheme();
  const { user } = useAuth();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {user ? (
          // Signed in: show tabs + optional modals
          <>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
          </>
        ) : (
          // Not signed in: show auth flow
          <Stack.Screen name="(auth)" />
        )}
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
