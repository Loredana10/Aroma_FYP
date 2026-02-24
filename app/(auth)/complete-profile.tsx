// app/(auth)/complete-profile.tsx
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { useAuth } from '@/contexts/auth_context';
import { API_BASE_URL } from '@/constants/api';

// Convert a numeric age to the age range string used in the database
const getAgeRange = (age: number): string => {
  if (age < 18)  return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
};

export default function CompleteProfile() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [coffeeFrequency, setCoffeeFrequency] = useState('');
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);

  const genderOptions = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const frequencyOptions = [
    'Every day',
    'A few times a week',
    'Once a week',
    'A few times a month',
    'Rarely',
  ];
  const dietaryOptions = [
    'None',
    'Lactose Intolerant',
    'Vegan',
    'Vegetarian',
    'Dairy-free',
    'Sugar-free',
    'Caffeine-sensitive',
  ];

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

  const handleComplete = async () => {
    if (!gender) {
      Alert.alert('Missing Information', 'Please select your gender.');
      return;
    }
    if (!age || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) {
      Alert.alert('Invalid Age', 'Please enter a valid age between 1 and 120.');
      return;
    }
    if (!coffeeFrequency) {
      Alert.alert('Missing Information', 'Please select how often you drink coffee.');
      return;
    }
    if (dietaryRestrictions.length === 0) {
      Alert.alert('Missing Information', 'Please select at least one dietary option (or "None").');
      return;
    }

    try {
      setLoading(true);
      if (!user) throw new Error('No user found');

      const ageNumber = Number(age);
      const ageRange = getAgeRange(ageNumber);

      // 1. Update Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        gender,
        age: ageNumber,
        ageRange,
        coffeeFrequency,
        dietaryRestrictions,
        profileCompleted: true,
      });

      // 2. Update PostgreSQL with age_range and coffee_frequency
      try {
        await fetch(`${API_BASE_URL}/api/users/${user.uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            age_range: ageRange,
            coffee_frequency: coffeeFrequency,
            gender: gender,
          }),
        });
      } catch (apiError) {
        // Non-fatal — Firestore already saved, PostgreSQL will sync later
        console.error('Failed to update PostgreSQL profile:', apiError);
      }
      // Navigation handled automatically by the layout's onSnapshot listener
      // When profileCompleted flips to true in Firestore, layout redirects to /(tabs)

    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const displayName = user?.displayName || 'there';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>Hello, {displayName}! 👋</Text>
      <Text style={styles.subtitle}>
        Welcome to Aroma! We need a few more details to personalise your coffee experience.
      </Text>

      {/* Gender */}
      <Text style={styles.label}>Gender</Text>
      <View style={styles.optionsContainer}>
        {genderOptions.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionButton, gender === option && styles.optionButtonSelected]}
            onPress={() => setGender(option)}
          >
            <Text style={[styles.optionText, gender === option && styles.optionTextSelected]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Age */}
      <Text style={styles.label}>Age</Text>
      <TextInput
        placeholder="Enter your age"
        keyboardType="number-pad"
        value={age}
        onChangeText={setAge}
        style={styles.input}
        maxLength={3}
      />
      {/* Show the age range preview as the user types */}
      {age && !isNaN(Number(age)) && Number(age) > 0 && (
        <Text style={styles.ageRangePreview}>
          Age range: {getAgeRange(Number(age))}
        </Text>
      )}

      {/* Coffee Frequency */}
      <Text style={styles.label}>How often do you drink coffee or tea?</Text>
      <View style={styles.optionsContainer}>
        {frequencyOptions.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionButton, coffeeFrequency === option && styles.optionButtonSelected]}
            onPress={() => setCoffeeFrequency(option)}
          >
            <Text style={[styles.optionText, coffeeFrequency === option && styles.optionTextSelected]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Dietary Restrictions */}
      <Text style={styles.label}>Dietary Restrictions</Text>
      <Text style={styles.sublabel}>Select all that apply</Text>
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

      {/* Complete Button */}
      <TouchableOpacity
        style={[styles.completeButton, loading && styles.completeButtonDisabled]}
        onPress={handleComplete}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.completeButtonText}>Complete Setup</Text>
        )}
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
  greeting: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 20,
  },
  sublabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  ageRangePreview: {
    fontSize: 13,
    color: '#4285F4',
    fontWeight: '500',
    marginTop: 6,
    marginLeft: 4,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  optionButtonSelected: {
    backgroundColor: '#4285F4',
    borderColor: '#4285F4',
  },
  optionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  completeButton: {
    backgroundColor: '#4285F4',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  completeButtonDisabled: {
    backgroundColor: '#999',
  },
  completeButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
});