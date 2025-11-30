import { Drink, MOCK_DRINKS } from '@/data/drinks';
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
  energyLevel: number;
  timeOfDay: string | null;
  weather: string | null;
  dietaryRestrictions: string[];
}

interface RecommendationResult {
  drink: Drink;
  matchPercentage: number;
  reason: string;
}

export default function PersonalisedScreen() {
  const router = useRouter();
  const [showQuestionnaire, setShowQuestionnaire] = useState(true);
  const [recommendations, setRecommendations] = useState<RecommendationResult[]>([]);

  // Questionnaire state
  const [mood, setMood] = useState<string | null>(null);
  const [energyLevel, setEnergyLevel] = useState<number>(5);
  const [timeOfDay, setTimeOfDay] = useState<string | null>(null);
  const [weather, setWeather] = useState<string | null>(null);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);

  const moods = ['Tired', 'Energetic', 'Focused', 'Calm', 'Anxious', 'Happy'];
  const times = ['Early Morning', 'Morning', 'Lunch', 'Afternoon', 'Evening', 'Night'];
  const weathers = ['Hot/Sunny', 'Warm', 'Cool', 'Cold', 'Rainy'];
  const restrictions = ['Dairy-free', 'Vegan', 'Gluten-free'];

  const toggleRestriction = (restriction: string) => {
    if (dietaryRestrictions.includes(restriction)) {
      setDietaryRestrictions(dietaryRestrictions.filter((r) => r !== restriction));
    } else {
      setDietaryRestrictions([...dietaryRestrictions, restriction]);
    }
  };

  const calculateRecommendations = () => {
    if (!mood || !timeOfDay || !weather) {
      Alert.alert('Incomplete', 'Please answer all questions before getting recommendations.');
      return;
    }

    let scoredDrinks = MOCK_DRINKS.map((drink) => {
      let score = 0;
      let reasons: string[] = [];

      // Filter by dietary restrictions first
      if (dietaryRestrictions.includes('Dairy-free') && !drink.dairyFree) return null;
      if (dietaryRestrictions.includes('Vegan') && !drink.vegan) return null;
      if (dietaryRestrictions.includes('Gluten-free') && !drink.glutenFree) return null;

      // Mood-based scoring
      if (mood === 'Tired' && drink.caffeine === 'high') {
        score += 30;
        reasons.push('high caffeine for energy');
      }
      if (mood === 'Energetic' && drink.caffeine === 'medium') {
        score += 20;
        reasons.push('moderate caffeine to maintain energy');
      }
      if (mood === 'Calm' && drink.caffeine === 'none') {
        score += 30;
        reasons.push('caffeine-free for relaxation');
      }
      if (mood === 'Anxious' && drink.caffeine === 'none') {
        score += 30;
        reasons.push('no caffeine to avoid jitters');
      }
      if (mood === 'Focused' && drink.caffeine === 'medium') {
        score += 25;
        reasons.push('balanced caffeine for concentration');
      }
      if (mood === 'Happy' && drink.sweetness === 'sweet') {
        score += 15;
        reasons.push('sweet treat to match your mood');
      }

      // Energy level scoring
      if (energyLevel <= 3 && drink.caffeine === 'high') {
        score += 25;
        reasons.push('strong boost for low energy');
      }
      if (energyLevel >= 7 && drink.caffeine === 'low') {
        score += 20;
        reasons.push('gentle option for high energy');
      }

      // Time of day scoring
      if ((timeOfDay === 'Early Morning' || timeOfDay === 'Morning') && drink.caffeine === 'high') {
        score += 20;
        reasons.push('perfect morning energizer');
      }
      if ((timeOfDay === 'Evening' || timeOfDay === 'Night') && drink.caffeine === 'none') {
        score += 25;
        reasons.push('caffeine-free for evening');
      }
      if (timeOfDay === 'Afternoon' && drink.caffeine === 'medium') {
        score += 15;
        reasons.push('afternoon pick-me-up');
      }

      // Weather-based scoring
      if ((weather === 'Hot/Sunny' || weather === 'Warm') && drink.temperature === 'cold') {
        score += 20;
        reasons.push('refreshing cold drink');
      }
      if ((weather === 'Hot/Sunny' || weather === 'Warm') && drink.temperature === 'both') {
        score += 10;
      }
      if ((weather === 'Cool' || weather === 'Cold' || weather === 'Rainy') && drink.temperature === 'hot') {
        score += 20;
        reasons.push('warming hot drink');
      }

      // Base score for matching type
      if (drink.type === 'Coffee') score += 10;

      // Cap at 100
      const matchPercentage = Math.min(score, 100);

      return {
        drink,
        matchPercentage,
        reason: reasons.length > 0 ? reasons.join(', ') : 'good general option',
      };
    });

    // Filter out nulls (dietary restrictions failed)
    const filtered = scoredDrinks.filter((item) => item !== null) as RecommendationResult[];

    // Sort by match percentage
    filtered.sort((a, b) => b.matchPercentage - a.matchPercentage);

    // Take top 5
    const topRecommendations = filtered.slice(0, 5);

    if (topRecommendations.length === 0) {
      Alert.alert('No matches', 'No drinks match your dietary restrictions. Try different options.');
      return;
    }

    setRecommendations(topRecommendations);
    setShowQuestionnaire(false);
  };

  const resetQuestionnaire = () => {
    setMood(null);
    setEnergyLevel(5);
    setTimeOfDay(null);
    setWeather(null);
    setDietaryRestrictions([]);
    setRecommendations([]);
    setShowQuestionnaire(true);
  };

  if (showQuestionnaire) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}> Find Your Perfect Drink</Text>
        <Text style={styles.subtitle}>Answer a few questions to get personalized recommendations</Text>

        {/* Mood */}
        <View style={styles.section}>
          <Text style={styles.label}>How are you feeling right now?</Text>
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

        {/* Energy Level */}
        <View style={styles.section}>
          <Text style={styles.label}>What's your current energy level?</Text>
          <Text style={styles.sliderValue}>{energyLevel}/10</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={10}
            step={1}
            value={energyLevel}
            onValueChange={setEnergyLevel}
            minimumTrackTintColor="#483C32"
            maximumTrackTintColor="#d3d3d3"
            thumbTintColor="#282019ff"
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>Low energy</Text>
            <Text style={styles.sliderLabel}>High energy</Text>
          </View>
        </View>

        {/* Time of Day */}
        <View style={styles.section}>
          <Text style={styles.label}>What time is it?</Text>
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

        {/* Weather */}
        <View style={styles.section}>
          <Text style={styles.label}>What's the weather like?</Text>
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

        {/* Dietary Restrictions */}
        <View style={styles.section}>
          <Text style={styles.label}>Any dietary restrictions? (Optional)</Text>
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

        <TouchableOpacity style={styles.submitButton} onPress={calculateRecommendations}>
          <Text style={styles.submitButtonText}>Get Recommendations</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Show recommendations
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>☕ Your Perfect Matches</Text>
      <Text style={styles.subtitle}>Based on your preferences</Text>

      {recommendations.map((rec, index) => (
        <View key={rec.drink.id} style={styles.recommendationCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.rank}>#{index + 1}</Text>
            <View style={styles.matchBadge}>
              <Text style={styles.matchText}>{rec.matchPercentage}% Match</Text>
            </View>
          </View>

          {/* For demo: using emoji as placeholder. Replace with rec.drink.image */}
          <View style={styles.drinkImageContainer}>
            <Text style={styles.drinkEmoji}>☕</Text>
          </View>

          <Text style={styles.drinkName}>{rec.drink.name}</Text>
          <Text style={styles.drinkDescription}>{rec.drink.description}</Text>
          <Text style={styles.drinkReason}>✨ {rec.reason}</Text>

          <View style={styles.drinkTags}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{rec.drink.type}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{rec.drink.caffeine} caffeine</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{rec.drink.temperature}</Text>
            </View>
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.retakeButton} onPress={resetQuestionnaire}>
        <Text style={styles.retakeButtonText}>Take Quiz Again</Text>
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
  slider: {
    width: '100%',
    height: 40,
    color: '#483C32',
  },
  sliderValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#483C32',
    textAlign: 'center',
    marginBottom: 8,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#999',
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
  recommendationCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rank: {
    fontSize: 20,
    fontWeight: '700',
    color: '#7c4dff',
  },
  matchBadge: {
    backgroundColor: '#7c4dff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  matchText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  drinkImageContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  drinkEmoji: {
    fontSize: 60,
  },
  drinkName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  drinkDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  drinkReason: {
    fontSize: 14,
    color: '#7c4dff',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  drinkTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#f3e5ff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    color: '#7c4dff',
    fontWeight: '500',
  },
  retakeButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#7c4dff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  retakeButtonText: {
    color: '#7c4dff',
    fontSize: 16,
    fontWeight: '600',
  },
});