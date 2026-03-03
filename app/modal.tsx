import { Link } from 'expo-router';
import { StyleSheet, View, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ModalScreen() {
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Text style={[styles.title, { color: C.text }]}>Modal</Text>
      <Link href="/" dismissTo style={styles.link}>
        <Text style={[styles.linkText, { color: C.primary }]}>Go to home screen</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  title:     { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  link:      { marginTop: 15, paddingVertical: 15 },
  linkText:  { fontSize: 15, fontWeight: '500' },
});