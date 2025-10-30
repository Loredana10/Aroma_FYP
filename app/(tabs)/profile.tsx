import { View, Text, Button } from 'react-native';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 22 }}>Loredana Bura</Text>
      <Text style={{ color: '#666' }}>Coffee Lover ☕</Text>
      <Button title="Settings" onPress={() => router.push('/settings')} />
    </View>
  );
}
