// app/(tabs)/settings.tsx
import { View, Text, Button, Alert, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '@/contexts/auth_context';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function SettingsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  
  // Profile data
  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);

  const genderOptions = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const dietaryOptions = [
    'None',
    'Lactose Intolerant',
    'Vegan',
    'Vegetarian',
    'Dairy-free',
    'Sugar-free',
    'Caffeine-sensitive',
  ];

  useEffect(() => {
    loadUserProfile();
  }, [user]);

  const loadUserProfile = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setDisplayName(data.displayName || '');
        setGender(data.gender || '');
        setAge(data.age?.toString() || '');
        setDietaryRestrictions(data.dietaryRestrictions || []);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const toggleDietaryRestriction = (option: string) => {
    if (option === 'None') {
      setDietaryRestrictions(['None']);
    } else {
      setDietaryRestrictions((prev) => {
        const filtered = prev.filter((item) => item !== 'None');
        if (prev.includes(option)) {
          return filtered.filter((item) => item !== option);
        } else {
          return [...filtered, option];
        }
      });
    }
  };

  const handleSave = async () => {
    if (!gender) {
      Alert.alert('Missing Information', 'Please select your gender.');
      return;
    }
    if (!age || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) {
      Alert.alert('Invalid Age', 'Please enter a valid age between 1 and 120.');
      return;
    }
    if (dietaryRestrictions.length === 0) {
      Alert.alert('Missing Information', 'Please select at least one dietary option (or "None").');
      return;
    }

    try {
      setSaving(true);
      if (!user) throw new Error('No user found');

      await updateDoc(doc(db, 'users', user.uid), {
        displayName,
        gender,
        age: Number(age),
        dietaryRestrictions,
      });

      Alert.alert('Success', 'Profile updated successfully!');
      setEditing(false);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut(auth);
              router.replace('/(auth)/signin');
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285F4" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings ⚙️</Text>
      
      {/* User Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Email:</Text>
          <Text style={styles.value}>{user?.email}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>User ID:</Text>
          <Text style={styles.valueSmall}>{user?.uid}</Text>
        </View>
      </View>

      {/* Profile Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Profile Details</Text>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={styles.editButton}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {editing ? (
          // Edit Mode
          <>
            <Text style={styles.fieldLabel}>Display Name</Text>
            <TextInput
              placeholder="Your name"
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.optionsContainer}>
              {genderOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionButton,
                    gender === option && styles.optionButtonSelected,
                  ]}
                  onPress={() => setGender(option)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      gender === option && styles.optionTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Age</Text>
            <TextInput
              placeholder="Enter your age"
              keyboardType="number-pad"
              value={age}
              onChangeText={setAge}
              style={styles.input}
              maxLength={3}
            />

            <Text style={styles.fieldLabel}>Dietary Restrictions</Text>
            <View style={styles.optionsContainer}>
              {dietaryOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.optionButton,
                    dietaryRestrictions.includes(option) && styles.optionButtonSelected,
                  ]}
                  onPress={() => toggleDietaryRestriction(option)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      dietaryRestrictions.includes(option) && styles.optionTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setEditing(false);
                  loadUserProfile(); // Reset to original values
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          // View Mode
          <>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Name:</Text>
              <Text style={styles.value}>{displayName || 'Not set'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Gender:</Text>
              <Text style={styles.value}>{gender || 'Not set'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Age:</Text>
              <Text style={styles.value}>{age || 'Not set'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Dietary Restrictions:</Text>
              <Text style={styles.value}>
                {dietaryRestrictions.length > 0 ? dietaryRestrictions.join(', ') : 'Not set'}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 30,
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  editButton: {
    color: '#4285F4',
    fontSize: 16,
    fontWeight: '600',
  },
  infoRow: {
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  value: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  valueSmall: {
    fontSize: 12,
    color: '#999',
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  optionButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  optionButtonSelected: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  optionText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#ddd',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#4285F4',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#999',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#FF3B30',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  logoutButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
});