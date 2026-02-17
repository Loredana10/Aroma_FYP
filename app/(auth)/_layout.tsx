import { Stack } from 'expo-router';
import React, { useEffect } from 'react';

// Conditionally import Google Sign-In (won't crash if not available)
let GoogleSignin: any;
try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
} catch (error) {
  console.log('Google Sign-In not available in this build');
}

export default function AuthLayout() {
  useEffect(() => {
    // Only configure if GoogleSignin is available (native build)
    if (GoogleSignin) {
      GoogleSignin.configure({
        webClientId: '790836001021-rr2n97tmdge2mrglh7apojvm49ce1k9s.apps.googleusercontent.com',
        offlineAccess: true,
      });
    }
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="signin" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="complete-profile" />
    </Stack>
  );
}