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
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
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

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignUp = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (displayName) await updateProfile(cred.user, { displayName });

      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        displayName: displayName || null,
        createdAt: serverTimestamp(),
        provider: 'email',
        profileCompleted: false,
      });
      // Redirect to complete profile
      router.replace('/(auth)/complete-profile');
    } catch (e: any) {
      Alert.alert('Sign up failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignUp = async () => {
    if (!isGoogleAvailable) {
      Alert.alert(
        'Google Sign-In Unavailable',
        'Google Sign-In requires a native build. Please use email/password or build with EAS.'
      );
      return;
    }

    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const { data } = await GoogleSignin.signIn();
      
      if (!data?.idToken) throw new Error('Google Sign-In failed');

      const credential = GoogleAuthProvider.credential(data.idToken);
      const userCredential = await signInWithCredential(auth, credential);

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
        // Redirect to complete profile for new Google users
        router.replace('/(auth)/complete-profile');
      } else{
        // existing user
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      if (error.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-Up Failed', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create account</Text>
      <TextInput 
        placeholder="Display name" 
        value={displayName} 
        onChangeText={setDisplayName} 
        style={styles.input} 
        editable={!loading} 
      />
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
      <Button 
        title={loading ? 'Creating account...' : 'Sign up'} 
        onPress={onSignUp} 
        disabled={loading} 
      />
      
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity 
        style={[styles.googleButton, !isGoogleAvailable && styles.googleButtonDisabled]} 
        onPress={onGoogleSignUp} 
        disabled={loading}
      >
        <Text style={styles.googleButtonText}>
          🔵 Continue with Google {!isGoogleAvailable && '(Native build required)'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.signinText}>
        Already have an account? <Link href="/(auth)/signin" style={{color: '#4285F4'}}>Sign in</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 12, padding: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, borderColor: '#ddd' },
  signinText: { textAlign: 'center', marginTop: 12 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ddd' },
  dividerText: { marginHorizontal: 10, color: '#666', fontWeight: '500' },
  googleButton: { backgroundColor: '#4285F4', padding: 14, borderRadius: 8, alignItems: 'center' },
  googleButtonDisabled: { backgroundColor: '#999' },
  googleButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});