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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── SHARED DIETARY OPTIONS ──────────────────────────────────────────────────
// These must match exactly what is stored in Firestore and shown in profile/onboarding

export const DIETARY_OPTIONS = [
  { value: 'Dairy-free',  label: 'Dairy-free',  icon: '🥛', sublabel: 'No milk, cream or dairy' },
  { value: 'Vegan',       label: 'Vegan',        icon: '🌱', sublabel: 'No animal products' },
  { value: 'Gluten-free', label: 'Gluten-free',  icon: '🌾', sublabel: 'No wheat or gluten' },
  { value: 'Nut allergy', label: 'Nut allergy',  icon: '🥜', sublabel: 'No almond or nut-based drinks' },
];

// ─── QUESTION DATA ────────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  {
    value:    'Tired and need a boost',
    label:    'Need a boost',
    sublabel: 'Tired and looking for energy',
    icon:     '⚡',
  },
  {
    value:    'Fairly okay, just want a drink',
    label:    'Just fancy a drink',
    sublabel: 'No particular need, just enjoying one',
    icon:     '☕',
  },
  {
    value:    'Relaxed and winding down',
    label:    'Winding down',
    sublabel: 'Relaxed, nothing too intense',
    icon:     '🌙',
  },
];

const TIME_OPTIONS = [
  { value: 'Morning',   label: 'Morning',   sublabel: 'Before midday',  icon: '🌅' },
  { value: 'Afternoon', label: 'Afternoon', sublabel: 'Midday to 5pm',  icon: '☀️' },
  { value: 'Evening',   label: 'Evening',   sublabel: 'After 5pm',      icon: '🌆' },
];

const WEATHER_OPTIONS = [
  { value: 'Hot/Warm', label: 'Warm', sublabel: 'Sunny or mild outside', icon: '🌤️' },
  { value: 'Cold',     label: 'Cold', sublabel: 'Chilly or rainy',       icon: '🌧️' },
];

const STEP_TITLES = [
  'How are you feeling?',
  'What time of day is it?',
  'What\'s the weather like?',
  'Any dietary needs?',
];

const STEP_SUBTITLES = [
  'This helps us match a drink to your current energy and mood',
  'We\'ll suggest something suited to the time of day',
  'Hot or cold drinks depend on the weather',
  'We\'ll filter out anything that doesn\'t suit you',
];

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface QuestionnaireData {
  mood:                string;
  timeOfDay:           string;
  weather:             string;
  dietaryRestrictions: string[];
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
  const [mood,                setMood]                = useState<string | null>(null);
  const [timeOfDay,           setTimeOfDay]           = useState<string | null>(null);
  const [weather,             setWeather]             = useState<string | null>(null);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [result,              setResult]              = useState<QuestionnaireData | null>(null);

  // Profile dietary state
  const [profileDietary,     setProfileDietary]     = useState<string[]>([]);
  const [loadingProfile,     setLoadingProfile]      = useState(true);

  const progressAnim = useRef(new Animated.Value(0)).current;

  // ─── LOAD PROFILE DIETARY ON MOUNT ─────────────────────────────────────────

  useEffect(() => {
    loadProfileDietary();
  }, [user]);

  const loadProfileDietary = async () => {
    if (!user) { setLoadingProfile(false); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        const restrictions: string[] = (data.dietaryRestrictions || [])
          // Filter to only the options we surface in this screen (exclude legacy values like 'None')
          .filter((r: string) => DIETARY_OPTIONS.some((o) => o.value === r));
        setProfileDietary(restrictions);
        // Pre-fill the dietary step with profile values
        setDietaryRestrictions(restrictions);
      }
    } catch (e) {
      console.error('Failed to load profile dietary:', e);
    } finally {
      setLoadingProfile(false);
    }
  };

  // ─── PROGRESS ANIMATION ────────────────────────────────────────────────────

  const animateProgress = (to: number) => {
    Animated.spring(progressAnim, {
      toValue: to, useNativeDriver: false, tension: 60, friction: 10,
    }).start();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp',
  });

  // ─── NAVIGATION ────────────────────────────────────────────────────────────

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

  const handleSubmit = () => {
    const data: QuestionnaireData = {
      mood:                mood!,
      timeOfDay:           timeOfDay!,
      weather:             weather!,
      dietaryRestrictions,
    };

    // Check if the user changed their dietary restrictions from their profile
    const profileSet  = new Set(profileDietary);
    const currentSet  = new Set(dietaryRestrictions);
    const hasChanged  =
      dietaryRestrictions.some((r) => !profileSet.has(r)) ||
      profileDietary.some((r) => !currentSet.has(r));

    if (hasChanged && profileDietary.length > 0) {
      // Prompt to update profile
      Alert.alert(
        'Update your profile?',
        'Your dietary preferences have changed. Would you like to save these as your default for future recommendations?',
        [
          {
            text: 'Just this once',
            style: 'cancel',
            onPress: () => { setResult(data); setStep(4); animateProgress(1); },
          },
          {
            text: 'Update profile',
            onPress: async () => {
              try {
                // Save the new restrictions (merge with non-dietary profile values)
                const snap = await getDoc(doc(db, 'users', user!.uid));
                const existing = snap.exists() ? snap.data() : {};
                // Keep 'None' if user has cleared all restrictions
                const toSave = dietaryRestrictions.length === 0 ? ['None'] : dietaryRestrictions;
                await updateDoc(doc(db, 'users', user!.uid), {
                  ...existing,
                  dietaryRestrictions: toSave,
                });
                setProfileDietary(dietaryRestrictions);
              } catch (e) {
                console.error('Failed to update profile dietary:', e);
              }
              setResult(data); setStep(4); animateProgress(1);
            },
          },
        ]
      );
    } else if (hasChanged && profileDietary.length === 0) {
      // No profile restrictions set yet — silently offer to save
      Alert.alert(
        'Save to your profile?',
        'Would you like to save these dietary preferences to your profile for future recommendations?',
        [
          {
            text: 'No thanks',
            style: 'cancel',
            onPress: () => { setResult(data); setStep(4); animateProgress(1); },
          },
          {
            text: 'Save',
            onPress: async () => {
              try {
                await updateDoc(doc(db, 'users', user!.uid), {
                  dietaryRestrictions: dietaryRestrictions.length === 0 ? ['None'] : dietaryRestrictions,
                });
                setProfileDietary(dietaryRestrictions);
              } catch {}
              setResult(data); setStep(4); animateProgress(1);
            },
          },
        ]
      );
    } else {
      setResult(data); setStep(4); animateProgress(1);
    }
  };

  const handleReset = () => {
    setMood(null); setTimeOfDay(null); setWeather(null);
    setDietaryRestrictions(profileDietary); // reset to profile values
    setResult(null); setStep(0); animateProgress(0);
  };

  const toggleDietary = (v: string) => {
    setDietaryRestrictions((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  };

  const canProceed = () => {
    if (step === 0) return !!mood;
    if (step === 1) return !!timeOfDay;
    if (step === 2) return !!weather;
    if (step === 3) return true; // optional
    return false;
  };

  // ─── LOADING ───────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // ─── RESULTS ───────────────────────────────────────────────────────────────

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

        <View style={s.summaryCard}>
          {[
            { label: 'Your mood',            value: result.mood },
            { label: 'Time of day',           value: result.timeOfDay },
            { label: 'Weather',               value: result.weather },
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

        {/* Placeholder — replace with rec output once backend is wired up */}
        <View style={s.recPlaceholder}>
          <Text style={s.recPlaceholderTitle}>Recommendation coming soon</Text>
          <Text style={s.recPlaceholderSub}>
            The recommendation engine will appear here once connected to this screen.
          </Text>
        </View>

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

  // ─── QUESTIONNAIRE ─────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Top nav */}
        <View style={s.topNav}>
          <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.7}>
            <Text style={s.backBtnText}>‹  Back</Text>
          </TouchableOpacity>
          <Text style={s.stepCounter}>{step + 1} / 4</Text>
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

        {/* Step 0 — Mood */}
        {step === 0 && (
          <View style={s.optionGroup}>
            {MOOD_OPTIONS.map((o) => (
              <OptionCard
                key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={mood === o.value} onPress={() => setMood(o.value)} s={s}
              />
            ))}
          </View>
        )}

        {/* Step 1 — Time */}
        {step === 1 && (
          <View style={s.optionGroup}>
            {TIME_OPTIONS.map((o) => (
              <OptionCard
                key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={timeOfDay === o.value} onPress={() => setTimeOfDay(o.value)} s={s}
              />
            ))}
          </View>
        )}

        {/* Step 2 — Weather */}
        {step === 2 && (
          <View style={s.optionGroup}>
            {WEATHER_OPTIONS.map((o) => (
              <OptionCard
                key={o.value} icon={o.icon} label={o.label} sublabel={o.sublabel}
                selected={weather === o.value} onPress={() => setWeather(o.value)} s={s}
              />
            ))}
          </View>
        )}

        {/* Step 3 — Dietary */}
        {step === 3 && (
          <View style={s.optionGroup}>

            {/* Profile pre-fill banner — only shown if profile has restrictions set */}
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

            {/* Dietary chips */}
            <View style={s.dietaryGrid}>
              {DIETARY_OPTIONS.map((o) => {
                const selected      = dietaryRestrictions.includes(o.value);
                const fromProfile   = profileDietary.includes(o.value);
                return (
                  <TouchableOpacity
                    key={o.value}
                    style={[s.dietaryChip, selected && s.dietaryChipSelected]}
                    onPress={() => toggleDietary(o.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.dietaryIcon}>{o.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.dietaryLabel, selected && s.dietaryLabelSelected]}>
                        {o.label}
                      </Text>
                      {fromProfile && (
                        <Text style={s.dietaryFromProfile}>From your profile</Text>
                      )}
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

            <Text style={s.skipNote}>
              Optional — leave all unselected if none apply.
            </Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.primaryBtn, !canProceed() && s.primaryBtnDisabled]}
          onPress={step === 3 ? handleSubmit : goNext}
          disabled={!canProceed()}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>
            {step === 3 ? 'Find my drink' : 'Continue'}
          </Text>
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

  optionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: C.border, gap: 14,
  },
  optionCardSelected:     { borderColor: C.primary, backgroundColor: C.primaryMuted },
  optionIconWrap:         { width: 48, height: 48, borderRadius: 12, backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optionIconWrapSelected: { backgroundColor: C.surface },
  optionIcon:             { fontSize: 22 },
  optionText:             { flex: 1 },
  optionLabel:            { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  optionLabelSelected:    { color: C.primary },
  optionSublabel:         { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  optionSublabelSelected: { color: C.textSecondary },

  optionRadio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optionRadioSelected: { borderColor: C.primary },
  optionRadioInner:  { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  // Profile pre-fill banner
  profileBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.primaryMuted, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 4,
  },
  profileBannerIcon:  { fontSize: 18, marginTop: 1 },
  profileBannerTitle: { fontSize: 13, fontWeight: '700', color: C.primary, marginBottom: 2 },
  profileBannerSub:   { fontSize: 12, color: C.textSecondary, lineHeight: 17 },

  // Dietary chips
  dietaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  dietaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: C.border,
    width: (SCREEN_WIDTH - 68) / 2,
  },
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

  // Results
  resultsHeader:    { alignItems: 'center', marginBottom: 32, paddingTop: 8 },
  resultsCheck:     { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  resultsCheckText: { fontSize: 26, color: '#fff', fontWeight: '700' },
  resultsTitle:     { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 6 },
  resultsSub:       { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20 },

  summaryCard:      { backgroundColor: C.surface, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: C.border, marginBottom: 20, shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  summaryRow:       { paddingVertical: 14, paddingHorizontal: 16 },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  summaryLabel:     { fontSize: 11, color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  summaryValue:     { fontSize: 15, color: C.text, fontWeight: '600' },

  recPlaceholder:      { backgroundColor: C.primaryMuted, borderRadius: 14, padding: 20, borderWidth: 1, borderColor: C.border, alignItems: 'center', marginBottom: 24 },
  recPlaceholderTitle: { fontSize: 15, fontWeight: '700', color: C.primary, marginBottom: 6 },
  recPlaceholderSub:   { fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },
});