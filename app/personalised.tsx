import { useRouter } from 'expo-router';
import { useState, useRef, useEffect } from 'react';
import {
  Animated, ScrollView, StyleSheet, Text,
  TouchableOpacity, View, Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { useAuth } from '@/contexts/auth_context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '@/constants/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── SHARED DIETARY OPTIONS ──────────────────────────────────────────────────

export const DIETARY_OPTIONS = [
  { value: 'Dairy-free',  label: 'Dairy-free',  icon: '🥛', sublabel: 'No milk, cream or dairy' },
  { value: 'Vegan',       label: 'Vegan',        icon: '🌱', sublabel: 'No animal products' },
  { value: 'Gluten-free', label: 'Gluten-free',  icon: '🌾', sublabel: 'No wheat or gluten' },
  { value: 'Nut allergy', label: 'Nut allergy',  icon: '🥜', sublabel: 'No almond or nut-based drinks' },
];

// ─── QUESTION DATA ────────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: 'Tired and need a boost',         label: 'Need a boost',      sublabel: 'Tired and looking for energy',          icon: '⚡' },
  { value: 'Fairly okay, just want a drink', label: 'Just fancy a drink', sublabel: 'No particular need, just enjoying one', icon: '☕' },
  { value: 'Relaxed and winding down',       label: 'Winding down',      sublabel: 'Relaxed, nothing too intense',          icon: '🌙' },
];

const TIME_OPTIONS = [
  { value: 'Morning',   label: 'Morning',   sublabel: 'Before midday', icon: '🌅' },
  { value: 'Afternoon', label: 'Afternoon', sublabel: 'Midday to 5pm', icon: '☀️' },
  { value: 'Evening',   label: 'Evening',   sublabel: 'After 5pm',     icon: '🌆' },
];

const WEATHER_OPTIONS = [
  { value: 'Hot/Warm', label: 'Warm', sublabel: 'Sunny or mild outside', icon: '🌤️' },
  { value: 'Cold',     label: 'Cold', sublabel: 'Chilly or rainy',       icon: '🌧️' },
];

const EXPLORE_OPTIONS = [
  { value: 'new',   label: 'Something new',           sublabel: "Discover drinks I haven't tried yet",            icon: '✨' },
  { value: 'tried', label: 'Include drinks I\'ve tried', sublabel: "Show me anything — including drinks I\'ve had before", icon: '☕' },
];

const STEP_TITLES = [
  'What are you looking for?',
  'How are you feeling?',
  'What time of day is it?',
  "What's the weather like?",
  'Any dietary needs?',
];

const STEP_SUBTITLES = [
  'Tell us whether you want to discover something new or revisit a favourite',
  'This helps us match a drink to your current energy and mood',
  "We'll suggest something suited to the time of day",
  'Hot or cold drinks depend on the weather',
  "We'll filter out anything that doesn't suit you",
];

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface QuestionnaireData {
  exploreNew:          string;
  mood:                string;
  timeOfDay:           string;
  weather:             string;
  dietaryRestrictions: string[];
}

interface Recommendation {
  drink_id:      number;
  name:          string;
  category:      string;
  type:          string;
  caffeine_mg:   number;
  dairy_free:    boolean;
  vegan:         boolean;
  gluten_free:   boolean;
  score:         number;
  match_percent: number;
  score_breakdown: { content: number; collaborative: number };
}

type Step = 0 | 1 | 2 | 3 | 4;

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function PersonalisedScreen() {
  const router      = useRouter();
  const { user }    = useAuth();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [step,                setStep]                = useState<Step>(0);
  const [exploreNew,          setExploreNew]          = useState<string | null>(null);
  const [mood,                setMood]                = useState<string | null>(null);
  const [timeOfDay,           setTimeOfDay]           = useState<string | null>(null);
  const [weather,             setWeather]             = useState<string | null>(null);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [result,              setResult]              = useState<QuestionnaireData | null>(null);

  // Profile dietary state
  const [profileDietary, setProfileDietary] = useState<string[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Recommendation state
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecs,     setLoadingRecs]     = useState(false);
  const [savedId,         setSavedId]         = useState<number | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;

  // ─── LOAD PROFILE DIETARY ON MOUNT ───────────────────────────────────────

  useEffect(() => { loadProfileDietary(); }, [user]);

  const loadProfileDietary = async () => {
    if (!user) { setLoadingProfile(false); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        const restrictions: string[] = (data.dietaryRestrictions || [])
          .filter((r: string) => DIETARY_OPTIONS.some((o) => o.value === r));
        setProfileDietary(restrictions);
        setDietaryRestrictions(restrictions);
      }
    } catch (e) {
      console.error('Failed to load profile dietary:', e);
    } finally {
      setLoadingProfile(false);
    }
  };

  // ─── PROGRESS ANIMATION ──────────────────────────────────────────────────

  const animateProgress = (to: number) => {
    Animated.spring(progressAnim, {
      toValue: to, useNativeDriver: false, tension: 60, friction: 10,
    }).start();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp',
  });

  // ─── NAVIGATION ──────────────────────────────────────────────────────────

  const goNext = () => {
    const next = (step + 1) as Step;
    setStep(next);
    animateProgress(next / 3);
  };

  const goBack = () => {
    if (step === 0) { router.back(); return; }
    const prev = (step - 1) as Step;
    setStep(prev);
    animateProgress(prev / 3);
  };

  const proceed = (data: QuestionnaireData) => {
    setResult(data);
    setStep(4);
    animateProgress(1);
    fetchRecommendations(data);
  };

  const handleSubmit = () => {
    const data: QuestionnaireData = {
      exploreNew: exploreNew!, mood: mood!, timeOfDay: timeOfDay!, weather: weather!, dietaryRestrictions,
    };

    const profileSet = new Set(profileDietary);
    const currentSet = new Set(dietaryRestrictions);
    const hasChanged =
      dietaryRestrictions.some((r) => !profileSet.has(r)) ||
      profileDietary.some((r) => !currentSet.has(r));

    if (hasChanged && profileDietary.length > 0) {
      Alert.alert(
        'Update your profile?',
        'Your dietary preferences have changed. Would you like to save these as your default for future recommendations?',
        [
          { text: 'Just this once', style: 'cancel', onPress: () => proceed(data) },
          {
            text: 'Update profile',
            onPress: async () => {
              try {
                const snap = await getDoc(doc(db, 'users', user!.uid));
                const existing = snap.exists() ? snap.data() : {};
                const toSave = dietaryRestrictions.length === 0 ? ['None'] : dietaryRestrictions;
                await updateDoc(doc(db, 'users', user!.uid), { ...existing, dietaryRestrictions: toSave });
                setProfileDietary(dietaryRestrictions);
              } catch (e) { console.error('Failed to update profile dietary:', e); }
              proceed(data);
            },
          },
        ]
      );
    } else if (hasChanged && profileDietary.length === 0) {
      Alert.alert(
        'Save to your profile?',
        'Would you like to save these dietary preferences to your profile for future recommendations?',
        [
          { text: 'No thanks', style: 'cancel', onPress: () => proceed(data) },
          {
            text: 'Save',
            onPress: async () => {
              try {
                await updateDoc(doc(db, 'users', user!.uid), {
                  dietaryRestrictions: dietaryRestrictions.length === 0 ? ['None'] : dietaryRestrictions,
                });
                setProfileDietary(dietaryRestrictions);
              } catch {}
              proceed(data);
            },
          },
        ]
      );
    } else {
      proceed(data);
    }
  };

  const handleReset = () => {
    setMood(null); setTimeOfDay(null); setWeather(null);
    setDietaryRestrictions(profileDietary);
    setResult(null); setRecommendations([]); setSavedId(null);
    setStep(0); animateProgress(0);
  };

  const toggleDietary = (v: string) => {
    setDietaryRestrictions((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  };

  const canProceed = () => {
    if (step === 0) return !!exploreNew;
    if (step === 1) return !!mood;
    if (step === 2) return !!timeOfDay;
    if (step === 3) return !!weather;
    if (step === 4) return true;
    return false;
  };

  // ─── FETCH RECOMMENDATIONS ───────────────────────────────────────────────

  const fetchRecommendations = async (data: QuestionnaireData) => {
    if (!user) return;
    setLoadingRecs(true);
    setRecommendations([]);
    setSavedId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/recommendations`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:              user.uid,
          mood:                 data.mood,
          time_of_day:          data.timeOfDay,
          weather:              data.weather,
          dietary_restrictions: data.dietaryRestrictions,
          explore_new: data.exploreNew === 'new',
        }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const json = await res.json();
      setRecommendations(json.recommendations || []);
    } catch (err) {
      console.error('Recommendation fetch error:', err);
      Alert.alert(
        'Could not load recommendations',
        'Make sure the server is running and try again.'
      );
    } finally {
      setLoadingRecs(false);
    }
  };

  // ─── SAVE TO HOME SCREEN ─────────────────────────────────────────────────
  // Writes the chosen drink to AsyncStorage as a pending recommendation.
  // The home screen reads this and shows the "come back and log it" card.

  const handleSaveDrink = async (rec: Recommendation) => {
    if (!user) return;
    try {
      // Save the recommendation including the questionnaire context so that
      // when the user logs it from the home screen, mood/time/weather are
      // stored in both the logs and ratings tables automatically.
      const pending = {
        drink_id:    rec.drink_id,
        name:        rec.name,
        category:    rec.category,
        type:        rec.type,
        caffeine_mg: rec.caffeine_mg,
        dairy_free:  rec.dairy_free,
        vegan:       rec.vegan,
        gluten_free: rec.gluten_free,
        saved_at:    new Date().toISOString(),
        // Questionnaire context — passed to logs/ratings when drink is logged
        // 'result' is the QuestionnaireData state set when the questionnaire completes
        mood:        result?.mood        ?? null,
        time_of_day: result?.timeOfDay   ?? null,
        weather:     result?.weather     ?? null,
        is_recommended: true,
      };
      await AsyncStorage.setItem(
        `pending_recommendation_${user.uid}`,
        JSON.stringify(pending)
      );
      setSavedId(rec.drink_id);
    } catch (err) {
      console.error('Save drink error:', err);
      Alert.alert('Error', 'Could not save this drink. Please try again.');
    }
  };

  // ─── LOADING ─────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // ─── RESULTS (step 4) ────────────────────────────────────────────────────

  if (step === 4 && result) {
    return (
      <ScrollView style={s.root} contentContainerStyle={s.scroll}>

        <View style={s.resultsHeader}>
          <View style={s.resultsCheck}>
            <Text style={s.resultsCheckText}>✓</Text>
          </View>
          <Text style={s.resultsTitle}>Your preferences</Text>
          <Text style={s.resultsSub}>
            Here's what we'll use to find your perfect drink
          </Text>
        </View>

        {/* Summary card — unchanged */}
        <View style={s.summaryCard}>
          {[
            { label: 'Your mood',           value: result.mood },
            { label: 'Time of day',          value: result.timeOfDay },
            { label: 'Weather',              value: result.weather },
            {
              label: 'Dietary restrictions',
              value: result.dietaryRestrictions.length > 0
                ? result.dietaryRestrictions.join(', ')
                : 'None',
            },
          ].map(({ label, value }, i, arr) => (
            <View key={label} style={[s.summaryRow, i < arr.length - 1 && s.summaryRowBorder]}>
              <Text style={s.summaryLabel}>{label}</Text>
              <Text style={s.summaryValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Recommendations section */}
        <Text style={s.recSectionTitle}>Your recommendations</Text>

        {loadingRecs ? (
          <View style={s.recLoading}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.recLoadingText}>Finding your perfect drink...</Text>
          </View>
        ) : recommendations.length === 0 ? (
          <View style={s.recPlaceholder}>
            <Text style={s.recPlaceholderTitle}>No recommendations found</Text>
            <Text style={s.recPlaceholderSub}>
              Try adjusting your dietary preferences or start over.
            </Text>
          </View>
        ) : (
          recommendations.map((rec, index) => {
            const isSaved = savedId === rec.drink_id;
            return (
              <View key={rec.drink_id} style={s.recCard}>

                {/* Rank + match */}
                <View style={s.recCardTop}>
                  <View style={s.rankBadge}>
                    <Text style={s.rankBadgeText}>#{index + 1}</Text>
                  </View>
                  <View style={s.matchPill}>
                    <Text style={s.matchPillText}>{rec.match_percent}% match</Text>
                  </View>
                </View>

                {/* Name + meta */}
                <Text style={s.recName}>{rec.name}</Text>
                <Text style={s.recMeta}>
                  {rec.category}  ·  {rec.type}  ·  {rec.caffeine_mg}mg caffeine
                </Text>

                {/* Dietary badges */}
                {(rec.dairy_free || rec.vegan || rec.gluten_free) && (
                  <View style={s.badgeRow}>
                    {rec.dairy_free  && <View style={s.badge}><Text style={s.badgeText}>Dairy-free</Text></View>}
                    {rec.vegan       && <View style={s.badge}><Text style={s.badgeText}>Vegan</Text></View>}
                    {rec.gluten_free && <View style={s.badge}><Text style={s.badgeText}>Gluten-free</Text></View>}
                  </View>
                )}

                {/* Save button */}
                <TouchableOpacity
                  style={[s.saveBtn, isSaved && s.saveBtnDone]}
                  onPress={() => { if (!isSaved) handleSaveDrink(rec); }}
                  activeOpacity={isSaved ? 1 : 0.8}
                >
                  <Text style={[s.saveBtnText, isSaved && s.saveBtnTextDone]}>
                    {isSaved ? 'Saved to home screen' : "That's my drink"}
                  </Text>
                </TouchableOpacity>

                {isSaved && (
                  <Text style={s.savedHint}>
                    Go enjoy it! Your home screen will remind you to log it when you're done.
                  </Text>
                )}
              </View>
            );
          })
        )}

        <TouchableOpacity style={s.primaryBtn} onPress={handleReset} activeOpacity={0.8}>
          <Text style={s.primaryBtnText}>Start over</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.ghostBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={s.ghostBtnText}>Back to home</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ─── QUESTIONNAIRE ───────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Top nav */}
        <View style={s.topNav}>
          <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.7}>
            <Text style={s.backBtnText}>‹  Back</Text>
          </TouchableOpacity>
          <Text style={s.stepCounter}>{step + 1} / 5</Text>
        </View>

        {/* Progress bar */}
        <View style={s.progressTrack}>
          <Animated.View style={[s.progressFill, { width: progressWidth }]} />
        </View>

        {/* Heading */}
        <View style={s.questionHeading}>
          <Text style={s.questionTitle}>{STEP_TITLES[step]}</Text>
          <Text style={s.questionSub}>{STEP_SUBTITLES[step]}</Text>
        </View>

        {/* Step 0 — Explore new or tried */}
        {step === 0 && (
          <View style={s.optionGroup}>
            {EXPLORE_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={exploreNew === o.value} onPress={() => setExploreNew(o.value)} s={s} />
            ))}
          </View>
        )}

        {/* Step 1 — Mood */}
        {step === 1 && (
          <View style={s.optionGroup}>
            {MOOD_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={mood === o.value} onPress={() => setMood(o.value)} s={s} />
            ))}
          </View>
        )}

        {/* Step 2 — Time */}
        {step === 2 && (
          <View style={s.optionGroup}>
            {TIME_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={timeOfDay === o.value} onPress={() => setTimeOfDay(o.value)} s={s} />
            ))}
          </View>
        )}

        {/* Step 3 — Weather */}
        {step === 3 && (
          <View style={s.optionGroup}>
            {WEATHER_OPTIONS.map((o) => (
              <OptionCard key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={weather === o.value} onPress={() => setWeather(o.value)} s={s} />
            ))}
          </View>
        )}

        {/* Step 4 — Dietary */}
        {step === 4 && (
          <View style={s.optionGroup}>

            {profileDietary.length > 0 && (
              <View style={s.profileBanner}>
                <Text style={s.profileBannerIcon}>👤</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.profileBannerTitle}>From your profile</Text>
                  <Text style={s.profileBannerSub}>
                    {profileDietary.join(', ')} — you can change this just for now, or update your profile.
                  </Text>
                </View>
              </View>
            )}

            <View style={s.dietaryGrid}>
              {DIETARY_OPTIONS.map((o) => {
                const selected    = dietaryRestrictions.includes(o.value);
                const fromProfile = profileDietary.includes(o.value);
                return (
                  <TouchableOpacity
                    key={o.value}
                    style={[s.dietaryChip, selected && s.dietaryChipSelected]}
                    onPress={() => toggleDietary(o.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.dietaryIcon}>{o.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dietaryLabel, selected && s.dietaryLabelSelected]}>{o.label}</Text>
                      {fromProfile && <Text style={s.dietaryFromProfile}>From your profile</Text>}
                    </View>
                    {selected && (
                      <View style={s.dietaryTick}>
                        <Text style={s.dietaryTickText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {dietaryRestrictions.length > 0 && (
              <TouchableOpacity onPress={() => setDietaryRestrictions([])} style={s.clearBtn}>
                <Text style={s.clearBtnText}>Clear all restrictions</Text>
              </TouchableOpacity>
            )}

            <Text style={s.skipNote}>Optional — leave all unselected if none apply.</Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.primaryBtn, !canProceed() && s.primaryBtnDisabled]}
          onPress={step === 4 ? handleSubmit : goNext}
          disabled={!canProceed()}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>{step === 4 ? 'Find my drink' : 'Continue'}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── OPTION CARD ─────────────────────────────────────────────────────────────

function OptionCard({ icon, label, sublabel, selected, onPress, s }: {
  icon: string; label: string; sublabel: string;
  selected: boolean; onPress: () => void; s: any;
}) {
  return (
    <TouchableOpacity
      style={[s.optionCard, selected && s.optionCardSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[s.optionIconWrap, selected && s.optionIconWrapSelected]}>
        <Text style={s.optionIcon}>{icon}</Text>
      </View>
      <View style={s.optionText}>
        <Text style={[s.optionLabel, selected && s.optionLabelSelected]}>{label}</Text>
        <Text style={[s.optionSublabel, selected && s.optionSublabelSelected]}>{sublabel}</Text>
      </View>
      <View style={[s.optionRadio, selected && s.optionRadioSelected]}>
        {selected && <View style={s.optionRadioInner} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 16 },

  topNav:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backBtn:     { paddingVertical: 4 },
  backBtnText: { color: C.primary, fontSize: 15, fontWeight: '500' },
  stepCounter: { fontSize: 13, color: C.textMuted, fontWeight: '500' },

  progressTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, marginBottom: 32, overflow: 'hidden' },
  progressFill:  { height: 4, backgroundColor: C.primary, borderRadius: 2 },

  questionHeading: { marginBottom: 28 },
  questionTitle:   { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 6, lineHeight: 30 },
  questionSub:     { fontSize: 14, color: C.textMuted, lineHeight: 20 },

  optionGroup: { gap: 12, marginBottom: 32 },

  optionCard:             { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: C.border, gap: 14 },
  optionCardSelected:     { borderColor: C.primary, backgroundColor: C.primaryMuted },
  optionIconWrap:         { width: 48, height: 48, borderRadius: 12, backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optionIconWrapSelected: { backgroundColor: C.surface },
  optionIcon:             { fontSize: 22 },
  optionText:             { flex: 1 },
  optionLabel:            { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  optionLabelSelected:    { color: C.primary },
  optionSublabel:         { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  optionSublabelSelected: { color: C.textSecondary },

  optionRadio:         { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optionRadioSelected: { borderColor: C.primary },
  optionRadioInner:    { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  // Profile banner
  profileBanner:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.primaryMuted, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 4 },
  profileBannerIcon:  { fontSize: 18, marginTop: 1 },
  profileBannerTitle: { fontSize: 13, fontWeight: '700', color: C.primary, marginBottom: 2 },
  profileBannerSub:   { fontSize: 12, color: C.textSecondary, lineHeight: 17 },

  // Dietary chips
  dietaryGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  dietaryChip:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.border, width: (SCREEN_WIDTH - 68) / 2 },
  dietaryChipSelected:  { borderColor: C.primary, backgroundColor: C.primaryMuted },
  dietaryIcon:          { fontSize: 18, flexShrink: 0 },
  dietaryLabel:         { fontSize: 13, fontWeight: '600', color: C.text },
  dietaryLabelSelected: { color: C.primary },
  dietaryFromProfile:   { fontSize: 11, color: C.primary, marginTop: 1, fontWeight: '500' },
  dietaryTick:          { width: 18, height: 18, borderRadius: 9, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  dietaryTickText:      { fontSize: 10, color: '#fff', fontWeight: '700' },

  clearBtn:     { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, marginBottom: 8 },
  clearBtnText: { fontSize: 13, color: C.textMuted, textDecorationLine: 'underline' },
  skipNote:     { fontSize: 12, color: C.textMuted, textAlign: 'center', lineHeight: 18, marginBottom: 8 },

  // Buttons
  primaryBtn:         { backgroundColor: C.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText:     { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },
  ghostBtn:           { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  ghostBtnText:       { color: C.textMuted, fontSize: 15, fontWeight: '500' },

  // Results header
  resultsHeader:    { alignItems: 'center', marginBottom: 32, paddingTop: 8 },
  resultsCheck:     { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  resultsCheckText: { fontSize: 26, color: '#fff', fontWeight: '700' },
  resultsTitle:     { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 6 },
  resultsSub:       { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20 },

  // Summary card
  summaryCard:      { backgroundColor: C.surface, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: C.border, marginBottom: 24, shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  summaryRow:       { paddingVertical: 14, paddingHorizontal: 16 },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  summaryLabel:     { fontSize: 11, color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  summaryValue:     { fontSize: 15, color: C.text, fontWeight: '600' },

  // Recommendations
  recSectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 14 },

  recLoading:     { alignItems: 'center', paddingVertical: 40 },
  recLoadingText: { marginTop: 14, fontSize: 14, color: C.textMuted },

  recPlaceholder:      { backgroundColor: C.primaryMuted, borderRadius: 14, padding: 20, borderWidth: 1, borderColor: C.border, alignItems: 'center', marginBottom: 24 },
  recPlaceholderTitle: { fontSize: 15, fontWeight: '700', color: C.primary, marginBottom: 6 },
  recPlaceholderSub:   { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },

  recCard:    { backgroundColor: C.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border, marginBottom: 14, shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  recCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },

  rankBadge:     { backgroundColor: C.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  rankBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  matchPill:     { backgroundColor: C.primaryMuted, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  matchPillText: { fontSize: 12, fontWeight: '600', color: C.primary },

  recName: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 },
  recMeta: { fontSize: 13, color: C.textMuted, marginBottom: 10 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  badge:     { backgroundColor: C.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.border },
  badgeText: { fontSize: 11, color: C.textSecondary, fontWeight: '600' },

  saveBtn:         { backgroundColor: C.primary, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  saveBtnDone:     { backgroundColor: C.primaryMuted },
  saveBtnText:     { color: '#fff', fontSize: 14, fontWeight: '600' },
  saveBtnTextDone: { color: C.primary },

  savedHint: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 17 },
});