import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  View, TextInput, Text, Alert, StyleSheet,
  TouchableOpacity, Image, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/firebaseConfig';
import { syncUserToDatabase } from '@/constants/api';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

let GoogleSignin: any;
let isGoogleAvailable = false;
try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
  isGoogleAvailable = true;
} catch { /* not available */ }

export default function SignIn() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

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
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await syncUserToDatabase(cred.user.uid, cred.user.email, cred.user.displayName);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (snap.exists() && !snap.data().profileCompleted) {
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
      Alert.alert('Unavailable', 'Google Sign-In requires a native build.');
      return;
    }
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const { data } = await GoogleSignin.signIn();
      if (!data?.idToken) throw new Error('No ID token returned');
      const credential = GoogleAuthProvider.credential(data.idToken);
      const cred = await signInWithCredential(auth, credential);
      await syncUserToDatabase(cred.user.uid, cred.user.email, cred.user.displayName);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (!snap.exists()) {
        await setDoc(doc(db, 'users', cred.user.uid), {
          email: cred.user.email, displayName: cred.user.displayName,
          photoURL: cred.user.photoURL, createdAt: serverTimestamp(),
          provider: 'google', profileCompleted: false,
        });
        router.replace('/(auth)/complete-profile');
      } else if (!snap.data().profileCompleted) {
        router.replace('/(auth)/complete-profile');
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      if (error.code !== 'SIGN_IN_CANCELLED') Alert.alert('Google Sign-In Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Brand mark */}
        <View style={s.brandBlock}>
          <View style={s.logoMark}>
            <Text style={s.logoLetter}>A</Text>
          </View>
          <Text style={s.brandName}>Aroma</Text>
          <Text style={s.brandTagline}>Your coffee, personalised</Text>
        </View>

        {/* Form */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Welcome back</Text>

          <Text style={s.fieldLabel}>Email</Text>
          <TextInput
            style={[s.input, loading && s.inputDisabled]}
            placeholder="your@email.com"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />

          <Text style={s.fieldLabel}>Password</Text>
          <TextInput
            style={[s.input, loading && s.inputDisabled]}
            placeholder="••••••••"
            placeholderTextColor={C.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
            onPress={onSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={s.primaryBtnText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Google */}
          <TouchableOpacity
            style={[s.googleBtn, loading && s.googleBtnDisabled]}
            onPress={onGoogleSignIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={s.googleIconWrap}>
              <Image
                source={require('@/assets/images/search.png')}
                style={s.googleIcon}
                resizeMode="contain"
              />
            </View>
            <Text style={s.googleBtnText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.footerText}>
          New here?{' '}
          <Link href="/(auth)/signup">
            <Text style={s.footerLink}>Create an account</Text>
          </Link>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },
  scroll:       { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },

  brandBlock:   { alignItems: 'center', marginBottom: 40 },
  logoMark:     { width: 64, height: 64, borderRadius: 18, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 12, shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  logoLetter:   { fontSize: 30, fontWeight: '700', color: '#fff' },
  brandName:    { fontSize: 28, fontWeight: '700', color: C.text, letterSpacing: 0.5 },
  brandTagline: { fontSize: 14, color: C.textMuted, marginTop: 4 },

  card:         { backgroundColor: C.surface, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: C.border, shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3, marginBottom: 24 },
  cardTitle:    { fontSize: 20, fontWeight: '600', color: C.text, marginBottom: 20 },

  fieldLabel:   { fontSize: 13, fontWeight: '500', color: C.textSecondary, marginBottom: 6, marginTop: 12 },
  input:        { backgroundColor: C.background, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  inputDisabled:{ opacity: 0.5 },

  primaryBtn:         { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText:     { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },

  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: C.textMuted, fontWeight: '500' },

  googleBtn:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.background, borderWidth: 1, borderColor: C.border, borderRadius: 10, height: 48 },
  googleBtnDisabled:{ opacity: 0.6 },
  googleIconWrap:   { width: 46, height: 46, borderRightWidth: 1, borderRightColor: C.border, justifyContent: 'center', alignItems: 'center' },
  googleIcon:       { width: 20, height: 20 },
  googleBtnText:    { flex: 1, textAlign: 'center', color: C.text, fontSize: 14, fontWeight: '500', paddingRight: 46 },

  footerText: { textAlign: 'center', fontSize: 14, color: C.textMuted },
  footerLink: { color: C.primary, fontWeight: '600' },
});