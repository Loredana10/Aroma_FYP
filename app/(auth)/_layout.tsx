import { Stack } from 'expo-router';
import React, { useEffect } from 'react';

let GoogleSignin: any;
try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
} catch (error) {
  console.log('Google Sign-In not available in this build');
}

export default function AuthLayout() {
  useEffect(() => {
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