import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, db } from '@/firebaseConfig';

// Configure Google Sign-In
GoogleSignin.configure({
  webClientId: '790836001021-rr2n97tmdge2mrglh7apojvm49ce1k9s.apps.googleusercontent.com',
});

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignUp = async () => {
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      // optional display name
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      // create a user profile doc
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        displayName: displayName || null,
        createdAt: serverTimestamp(),
        provider: 'email',
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Sign up failed', e?.message ?? 'Please try again.');
    } finally {      
      setLoading(false);
    }
  };

  const onGoogleSignUp = async () => {
    try {
      setLoading(true);
      
      // Check if device supports Google Play
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      //Get User Info
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult.data?.idToken;
      
      // Get user info
      if (!idToken) {
          throw new Error('No ID token returned from Google Sign-In');
      }
      
      // Create Firebase credential
      const googleCredential = GoogleAuthProvider.credential(idToken);
      
      // Sign in to Firebase
      const userCredential = await signInWithCredential(auth, googleCredential);
      const user = userCredential.user;
      
      // Create user profile in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          provider: 'google',
        });
      }
      
      console.log('Google sign-up successful');
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google sign-up error:', error);
      if (error.code === 'SIGN_IN_CANCELLED') {
        Alert.alert('Cancelled', 'Google sign-up was cancelled');
      } else {
        Alert.alert('Google Sign-Up Failed', error?.message ?? 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create account</Text>
      
      {/* Email/Password Sign Up */}
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
      <Button title="Sign up" onPress={onSignUp} disabled={loading} />
      
      {/* Divider */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>
      
      {/* Google Sign Up Button */}
      <TouchableOpacity 
        style={styles.googleButton} 
        onPress={onGoogleSignUp}
        disabled={loading}
      >
        <Text style={styles.googleButtonText}>
          🔵 Continue with Google
        </Text>
      </TouchableOpacity>
      
      <Text style={styles.signinText}>
        Already have an account? <Link href="/(auth)/signin">Sign in</Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
    padding: 16,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    borderColor: '#ddd',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#666',
    fontWeight: '500',
  },
  googleButton: {
    backgroundColor: '#4285F4',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  googleButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  signinText: {
    textAlign: 'center',
    marginTop: 12,
  },
});
