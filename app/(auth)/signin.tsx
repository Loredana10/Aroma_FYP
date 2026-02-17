import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  View,
  TextInput,
  Button,
  Text,
  Alert,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/firebaseConfig';

// Conditionally import Google Sign-In
let GoogleSignin: any;
let isGoogleAvailable = false;
try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
  isGoogleAvailable = true;
} catch (error) {
  console.log('Google Sign-In not available');
}

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter both email and password.');
      return;
    }
    try {
      setLoading(true);
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      
      // Check if profile is complete
      const userRef = doc(db, 'users', userCredential.user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists() && !userSnap.data().profileCompleted) {
        router.replace('/(auth)/complete-profile');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    if (!isGoogleAvailable) {
      Alert.alert(
        'Google Sign-In Unavailable',
        'Google Sign-In requires a native build. Please use email/password or build with EAS.'
      );
      return;
    }

    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      const { data } = await GoogleSignin.signIn();
      const idToken = data?.idToken;

      if (!idToken) throw new Error('No ID token returned');

      const googleCredential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, googleCredential);
      
      // Check if user document exists
      const userRef = doc(db, 'users', userCredential.user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // Brand new user - create document and go to onboarding
        await setDoc(userRef, {
          email: userCredential.user.email,
          displayName: userCredential.user.displayName,
          photoURL: userCredential.user.photoURL,
          createdAt: serverTimestamp(),
          provider: 'google',
          profileCompleted: false,
        });
        router.replace('/(auth)/complete-profile');
      } else if (userSnap.data().profileCompleted === false) {
        // Existing user who hasn't completed profile
        router.replace('/(auth)/complete-profile');
      } else {
        // Existing user with completed profile
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      if (error.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Failed', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LOG IN</Text>
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
        editable={!loading}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
        editable={!loading}
      />
      <Button title={loading ? 'Signing in...' : 'Sign in'} onPress={onSignIn} disabled={loading} />
      
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity 
        style={[styles.googleButton, !isGoogleAvailable && styles.googleButtonDisabled]} 
        onPress={onGoogleSignIn} 
        disabled={loading}
      >
        <Text style={styles.googleButtonText}>
          🔵 Continue with Google {!isGoogleAvailable && '(Native build required)'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.signupText}>
        New here? <Link href="/(auth)/signup" style={{color: '#4285F4'}}>Create an account</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 12, padding: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, borderColor: '#ddd' },
  signupText: { textAlign: 'center', marginTop: 12 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ddd' },
  dividerText: { marginHorizontal: 10, color: '#666', fontWeight: '500' },
  googleButton: { backgroundColor: '#4285F4', padding: 14, borderRadius: 8, alignItems: 'center' },
  googleButtonDisabled: { backgroundColor: '#999' },
  googleButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});