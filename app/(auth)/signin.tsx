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
  Image,
} from 'react-native';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/firebaseConfig';
import { syncUserToDatabase } from '@/constants/api';

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

      // Sync user to PostgreSQL (creates if new, skips if already exists)
      await syncUserToDatabase(
        userCredential.user.uid,
        userCredential.user.email,
        userCredential.user.displayName
      );

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

      // Sync user to PostgreSQL
      await syncUserToDatabase(
        userCredential.user.uid,
        userCredential.user.email,
        userCredential.user.displayName
      );

      const userRef = doc(db, 'users', userCredential.user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
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
        router.replace('/(auth)/complete-profile');
      } else {
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
        style={[styles.googleButton, loading && styles.googleButtonDisabled]}
        onPress={onGoogleSignIn}
        disabled={loading}
        activeOpacity={0.85}
      >
        <View style={styles.googleIconContainer}>
          <Image
            source={require('@/assets/images/search.png')}
            style={styles.googleIcon}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.googleButtonText}>Sign in with Google</Text>
      </TouchableOpacity>

      <Text style={styles.signupText}>
        New here?{' '}
        <Link href="/(auth)/signup" style={{ color: '#4285F4' }}>
          Create an account
        </Link>
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 4,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  googleButtonDisabled: { opacity: 0.6 },
  googleIconContainer: {
    width: 46,
    height: 46,
    borderRightWidth: 1,
    borderRightColor: '#dadce0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIcon: { width: 22, height: 22 },
  googleButtonText: {
    flex: 1,
    textAlign: 'center',
    color: '#3c4043',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.25,
    paddingRight: 46,
  },
});
