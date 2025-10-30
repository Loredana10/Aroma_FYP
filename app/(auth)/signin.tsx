import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View, TextInput, Button, Text, Alert } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/firebaseConfig';

export default function SignIn() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const onSignIn = async () => {
        try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
            console.log('✅ Signed in successfully');
            router.replace('/(tabs)');
        } catch (e: any) {
            console.error('❌ Firebase sign-in error:', e);
            Alert.alert('Sign in failed', e?.message ?? 'Please try again.');
        }
    };

    return (
    <View style={{ flex: 1, gap: 12, padding: 16, justifyContent: 'center' }}>
        <Text style={{ fontSize: 28, fontWeight: '600', marginBottom: 8 }}>Welcome back</Text>
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
        <Button title="Sign in" onPress={onSignIn} />
        <Text style={{ textAlign: 'center', marginTop: 12 }}>
        New here? <Link href="/(auth)/signup">Create an account</Link>
        </Text>
    </View>
    );
}
