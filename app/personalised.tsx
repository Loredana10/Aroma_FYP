import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

interface QuestionnaireData {
  mood: string | null;
  timeOfDay: string | null;
  weather: string | null;
  dietaryRestrictions: string[];
}

export default function PersonalisedScreen() {
  const router = useRouter();
  const [showQuestionnaire, setShowQuestionnaire] = useState(true);
  const [submittedData, setSubmittedData] = useState<QuestionnaireData | null>(null);

  // Questionnaire state
  const [mood, setMood] = useState<string | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<string | null>(null);
  const [weather, setWeather] = useState<string | null>(null);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);

  // Simplified options based on supervisor feedback
  const moods = ['Tired', 'Not Tired'];
  const times = ['Morning', 'Afternoon', 'Evening'];
  const weathers = ['Hot/Warm', 'Cold'];
  const restrictions = ['Dairy-free', 'Vegan', 'Gluten-free'];

  const toggleRestriction = (restriction: string) => {
    if (dietaryRestrictions.includes(restriction)) {
      setDietaryRestrictions(dietaryRestrictions.filter((r) => r !== restriction));
    } else {
      setDietaryRestrictions([...dietaryRestrictions, restriction]);
    }
  };

  const handleSubmit = () => {
    if (!mood || !timeOfDay || !weather) {
      Alert.alert('Incomplete', 'Please answer all questions before submitting.');
      return;
    }

    // Store the submitted data
    const data: QuestionnaireData = {
      mood,
      timeOfDay,
      weather,
      dietaryRestrictions,
    };

    setSubmittedData(data);
    setShowQuestionnaire(false);
  };

  const resetQuestionnaire = () => {
    setMood(null);
    setTimeOfDay(null);
    setWeather(null);
    setDietaryRestrictions([]);
    setSubmittedData(null);
    setShowQuestionnaire(true);
  };

  if (showQuestionnaire) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}>Find Your Perfect Drink</Text>
        <Text style={styles.subtitle}>Answer a few questions to get personalised recommendations</Text>

        {/* Mood - Simplified to Tired/Not Tired */}
        <View style={styles.section}>
          <Text style={styles.label}>Mood: Are you tired?</Text>
          <View style={styles.optionsGrid}>
            {moods.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.option, mood === m && styles.optionSelected]}
                onPress={() => setMood(m)}
              >
                <Text style={[styles.optionText, mood === m && styles.optionTextSelected]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Time of Day - Simplified to Morning/Afternoon/Evening */}
        <View style={styles.section}>
          <Text style={styles.label}>Time:</Text>
          <View style={styles.optionsGrid}>
            {times.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.option, timeOfDay === t && styles.optionSelected]}
                onPress={() => setTimeOfDay(t)}
              >
                <Text style={[styles.optionText, timeOfDay === t && styles.optionTextSelected]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Weather - Simplified to Hot/Warm or Cold */}
        <View style={styles.section}>
          <Text style={styles.label}>Weather:</Text>
          <View style={styles.optionsGrid}>
            {weathers.map((w) => (
              <TouchableOpacity
                key={w}
                style={[styles.option, weather === w && styles.optionSelected]}
                onPress={() => setWeather(w)}
              >
                <Text style={[styles.optionText, weather === w && styles.optionTextSelected]}>{w}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Dietary Restrictions - Kept the same */}
        <View style={styles.section}>
          <Text style={styles.label}>Dietary Restrictions: (Optional)</Text>
          <View style={styles.optionsGrid}>
            {restrictions.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.option, dietaryRestrictions.includes(r) && styles.optionSelected]}
                onPress={() => toggleRestriction(r)}
              >
                <Text
                  style={[styles.optionText, dietaryRestrictions.includes(r) && styles.optionTextSelected]}
                >
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
          <Text style={styles.submitButtonText}>Get Recommendation</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Show submitted contextual data (for demo purposes)
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Your Contextual Data</Text>

      <View style={styles.resultCard}>
        <View style={styles.resultSection}>
          <Text style={styles.resultLabel}>Mood:</Text>
          <Text style={styles.resultValue}>{submittedData?.mood}</Text>
        </View>

        <View style={styles.resultSection}>
          <Text style={styles.resultLabel}>Time of Day:</Text>
          <Text style={styles.resultValue}>{submittedData?.timeOfDay}</Text>
        </View>

        <View style={styles.resultSection}>
          <Text style={styles.resultLabel}>Weather:</Text>
          <Text style={styles.resultValue}>{submittedData?.weather}</Text>
        </View>

        <View style={styles.resultSection}>
          <Text style={styles.resultLabel}>Dietary Restrictions:</Text>
          {submittedData?.dietaryRestrictions && submittedData.dietaryRestrictions.length > 0 ? (
            <View style={styles.restrictionsContainer}>
              {submittedData.dietaryRestrictions.map((restriction) => (
                <View key={restriction} style={styles.restrictionTag}>
                  <Text style={styles.restrictionText}>{restriction}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.resultValue}>None</Text>
          )}
        </View>
      </View>


      <TouchableOpacity style={styles.retakeButton} onPress={resetQuestionnaire}>
        <Text style={styles.retakeButtonText}>Enter New Data</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
        <Text style={styles.cancelButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#333',
    paddingTop: 25,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  section: {
    marginBottom: 28,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#d3d3d3',
    backgroundColor: '#fff',
  },
  optionSelected: {
    borderColor: '#483C32',
    backgroundColor: '#c3a994ff',
  },
  optionText: {
    fontSize: 14,
    color: '#666',
  },
  optionTextSelected: {
    color: '#483C32',
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#483C32',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultSection: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  resultValue: {
    fontSize: 20,
    color: '#333',
    fontWeight: '700',
  },
  restrictionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  restrictionTag: {
    backgroundColor: '#c3a994ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  restrictionText: {
    fontSize: 14,
    color: '#483C32',
    fontWeight: '600',
  },
  demoNote: {
    backgroundColor: '#fff3cd',
    borderLeftWidth: 4,
    borderLeftColor: '#ffb300',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  demoNoteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#856404',
    marginBottom: 8,
  },
  demoNoteText: {
    fontSize: 14,
    color: '#856404',
    lineHeight: 20,
  },
  retakeButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#483C32',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  retakeButtonText: {
    color: '#483C32',
    fontSize: 16,
    fontWeight: '600',
  },
});