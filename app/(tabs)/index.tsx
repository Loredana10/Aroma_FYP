import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Button, ActivityIndicator } from 'react-native';
import { useAuth } from '@/contexts/auth_context';
import { auth, db } from '@/firebaseConfig';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'expo-router';

export default function Index() {
  const { user } = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState('Loading your profile...');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        // If user doc doesn't exist, create it
        if (!snap.exists()) {
          await setDoc(userRef, {
            email: user.email,
            displayName: user.displayName ?? null,
            createdAt: serverTimestamp(),
          });
        }

        // Fetch fresh profile
        const fresh = await getDoc(userRef);
        setProfile(fresh.data());
        setMessage('Firestore connection successful ✅');
      } catch (e) {
        console.error('❌ Error fetching user profile:', e);
        setMessage('Failed to load your profile ❌');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7c4dff" />
        <Text style={styles.status}>{message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome back!</Text>
      {profile ? (
        <>
          <Text style={styles.subtitle}>User: {profile.email}</Text>
          {profile.displayName && <Text style={styles.subtitle}>Name: {profile.displayName}</Text>}
        </>
      ) : (
        <Text style={styles.status}>{message}</Text>
      )}
      <View style={{ marginTop: 30 }}>
        <Button title="☕ Get Personalized Drink" onPress={() => router.push('/personalised')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#333',
    marginVertical: 2,
  },
  status: {
    marginTop: 10,
    color: '#666',
    fontStyle: 'italic',
  },
});
