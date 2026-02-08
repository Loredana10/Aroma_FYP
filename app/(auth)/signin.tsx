import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, db } from '@/firebaseConfig';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// Configure Google Sign-In
GoogleSignin.configure({
  webClientId: '790836001021-rr2n97tmdge2mrglh7apojvm49ce1k9s.apps.googleusercontent.com',
});

export default function SignIn() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const onSignIn = async () => {
        try {
            setLoading(true);
            await signInWithEmailAndPassword(auth, email.trim(), password);
            console.log('Signed in successfully');
            router.replace('/(tabs)');
        } catch (e: any) {
            console.error('Firebase sign-in error:', e);
            Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const onGoogleSignIn = async () => {
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
        
        // Create/update user profile in Firestore
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            // Create new user document
            await setDoc(userRef, {
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: serverTimestamp(),
            provider: 'google',
            });
            console.log('Created new Google user in Firestore');
        }
        
        console.log('Google sign-in successful');
        router.replace('/(tabs)');
        } catch (error: any) {
        console.error('Google sign-in error:', error);
        if (error.code === 'SIGN_IN_CANCELLED') {
            // User cancelled the sign-in
            Alert.alert('Cancelled', 'Google sign-in was cancelled');
        } else {
            Alert.alert('Google Sign-In Failed', error?.message ?? 'Please try again.');
        }
        } finally {
        setLoading(false);
        }
    };

    return (
    <View style={styles.container}>
      <Text style={styles.title}>LOG IN</Text>
      
      {/* Email/Password Sign In */}
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
      <Button title="Sign in" onPress={onSignIn} disabled={loading} />
      
      {/* Divider */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>
      
      {/* Google Sign In Button */}
      <TouchableOpacity 
        style={styles.googleButton} 
        onPress={onGoogleSignIn}
        disabled={loading}
      >
        <Text style={styles.googleButtonText}>
          🔵 Continue with Google
        </Text>
      </TouchableOpacity>
      
      <Text style={styles.signupText}>
        New here? <Link href="/(auth)/signup">Create an account</Link>
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
  signupText: {
    textAlign: 'center',
    marginTop: 12,
  },
});