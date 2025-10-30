import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/firebaseConfig';

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  const onSignUp = async () => {
    try {
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
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Sign up failed', e?.message ?? 'Please try again.');
    }
  };

  return (
    <View style={{ flex: 1, gap: 12, padding: 16, justifyContent: 'center' }}>
      <Text style={{ fontSize: 28, fontWeight: '600', marginBottom: 8 }}>Create account</Text>
      <TextInput
        placeholder="Display name (optional)"
        value={displayName}
        onChangeText={setDisplayName}
        style={{ borderWidth: 1, borderRadius: 8, padding: 12 }}
      />
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderRadius: 8, padding: 12 }}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderRadius: 8, padding: 12 }}
      />
      <Button title="Sign up" onPress={onSignUp} />
      <Text style={{ textAlign: 'center', marginTop: 12 }}>
        Already have an account? <Link href="/(auth)/signin">Sign in</Link>
      </Text>
    </View>
  );
}
