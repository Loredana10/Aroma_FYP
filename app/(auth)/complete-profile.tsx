import { useRouter } from 'expo-router';
import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert,
  StyleSheet, ScrollView, ActivityIndicator, Animated,
  Dimensions,
} from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { useAuth } from '@/contexts/auth_context';
import { API_BASE_URL } from '@/constants/api';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MASCOTS } from '@/constants/mascots';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const getAgeRange = (age: number): string => {
  if (age < 18)  return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
};

// ─── STEP CONFIG ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    title:    'Choose your mascot',
    subtitle: 'Pick a character to represent you in the app — you can change this later in your profile',
  },
  {
    title:    'A bit about you',
    subtitle: 'This helps us personalise your recommendations',
  },
  {
    title:    'How often do you drink coffee or tea?',
    subtitle: 'We use this to better understand your habits',
  },
  {
    title:    'Any dietary restrictions?',
    subtitle: 'We\'ll use this to filter out drinks that don\'t suit you',
  },
];

const TOTAL_STEPS = STEPS.length;

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function CompleteProfile() {
  const router      = useRouter();
  const { user }    = useAuth();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);

  // Fields
  const [mascotId,             setMascotId]             = useState<string | null>(null);
  const [gender,               setGender]               = useState('');
  const [age,                  setAge]                  = useState('');
  const [coffeeFrequency,      setCoffeeFrequency]      = useState('');
  const [dietaryRestrictions,  setDietaryRestrictions]  = useState<string[]>([]);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const genderOptions    = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const frequencyOptions = ['Every day', 'A few times a week', 'Once a week', 'A few times a month', 'Rarely'];
  const dietaryOptions   = ['None', 'Dairy-free', 'Vegan', 'Gluten-free', 'Nut allergy'];

  // ─── PROGRESS ──────────────────────────────────────────────────────────────

  const animateProgress = (toStep: number) => {
    Animated.spring(progressAnim, {
      toValue:         toStep / (TOTAL_STEPS - 1),
      useNativeDriver: false,
      tension:         60,
      friction:        10,
    }).start();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  // ─── NAVIGATION ────────────────────────────────────────────────────────────

  const goNext = () => {
    // Validate current step before advancing
    if (step === 0 && !mascotId) {
      Alert.alert('Choose a mascot', 'Please pick a character to continue.');
      return;
    }
    if (step === 1) {
      if (!gender) { Alert.alert('Missing information', 'Please select your gender.'); return; }
      if (!age || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) {
        Alert.alert('Invalid age', 'Please enter a valid age between 1 and 120.'); return;
      }
    }
    if (step === 2 && !coffeeFrequency) {
      Alert.alert('Missing information', 'Please select how often you drink coffee or tea.'); return;
    }

    const next = step + 1;
    setStep(next);
    animateProgress(next);
  };

  const goBack = () => {
    const prev = step - 1;
    setStep(prev);
    animateProgress(prev);
  };

  // ─── DIETARY ───────────────────────────────────────────────────────────────

  const toggleDietary = (option: string) => {
    if (option === 'None') {
      setDietaryRestrictions(['None']);
    } else {
      setDietaryRestrictions((prev) => {
        const filtered = prev.filter((i) => i !== 'None');
        return prev.includes(option)
          ? filtered.filter((i) => i !== option)
          : [...filtered, option];
      });
    }
  };

  // ─── SUBMIT ────────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (dietaryRestrictions.length === 0) {
      Alert.alert('Missing information', 'Please select at least one dietary option (or "None").');
      return;
    }
    try {
      setLoading(true);
      if (!user) throw new Error('No user found');

      const ageNumber = Number(age);
      const ageRange  = getAgeRange(ageNumber);

      await updateDoc(doc(db, 'users', user.uid), {
        mascotId,
        gender,
        age:          ageNumber,
        ageRange,
        coffeeFrequency,
        dietaryRestrictions,
        profileCompleted: true,
      });

      // Sync to PostgreSQL — non-fatal
      try {
        await fetch(`${API_BASE_URL}/api/users/${user.uid}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            age_range:        ageRange,
            coffee_frequency: coffeeFrequency,
            gender,
          }),
        });
      } catch {}
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const displayName = user?.displayName || 'there';
  const selectedMascot = MASCOTS.find((m) => m.id === mascotId);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >

      {/* Header */}
      <View style={s.header}>
        <View style={s.logoMark}>
          <Text style={s.logoLetter}>A</Text>
        </View>
        <Text style={s.greeting}>Hello, {displayName}</Text>
        <Text style={s.subtitle}>Let's set up your profile</Text>
      </View>

      {/* Progress */}
      <View style={s.progressRow}>
        <View style={s.progressTrack}>
          <Animated.View style={[s.progressFill, { width: progressWidth }]} />
        </View>
        <Text style={s.progressLabel}>{step + 1} / {TOTAL_STEPS}</Text>
      </View>

      {/* Step title */}
      <View style={s.stepHeading}>
        <Text style={s.stepTitle}>{STEPS[step].title}</Text>
        <Text style={s.stepSubtitle}>{STEPS[step].subtitle}</Text>
      </View>

      {/* ── STEP 0: MASCOT PICKER ───────────────────────────────────────── */}
      {step === 0 && (
        <View style={s.mascotSection}>
          <View style={s.mascotGrid}>
            {MASCOTS.map((mascot) => {
              const isSelected = mascotId === mascot.id;
              return (
                <TouchableOpacity
                  key={mascot.id}
                  style={[s.mascotCell, isSelected && s.mascotCellSelected]}
                  onPress={() => setMascotId(mascot.id)}
                  activeOpacity={0.8}
                >
                  {/* Placeholder circle — swap for <Image> when real assets are ready */}
                  <View style={[s.mascotAvatar, isSelected && s.mascotAvatarSelected]}>
                    <Text style={s.mascotEmoji}>{mascot.placeholder}</Text>
                  </View>
                  <Text style={[s.mascotName, isSelected && s.mascotNameSelected]}>
                    {mascot.name}
                  </Text>
                  {isSelected && (
                    <View style={s.mascotTick}>
                      <Text style={s.mascotTickText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected preview */}
          {selectedMascot && (
            <View style={s.mascotPreview}>
              <View style={s.mascotPreviewAvatar}>
                <Text style={s.mascotPreviewEmoji}>{selectedMascot.placeholder}</Text>
              </View>
              <View>
                <Text style={s.mascotPreviewName}>{selectedMascot.name}</Text>
                <Text style={s.mascotPreviewSub}>Your mascot</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── STEP 1: GENDER + AGE ────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <View style={s.section}>
            <Text style={s.sectionLabel}>Gender</Text>
            <View style={s.chipGroup}>
              {genderOptions.map((o) => (
                <TouchableOpacity
                  key={o}
                  style={[s.chip, gender === o && s.chipSelected]}
                  onPress={() => setGender(o)}
                >
                  <Text style={[s.chipText, gender === o && s.chipTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>Age</Text>
            <TextInput
              placeholder="Enter your age"
              placeholderTextColor={C.textMuted}
              keyboardType="number-pad"
              value={age}
              onChangeText={setAge}
              style={s.input}
              maxLength={3}
            />
            {age && !isNaN(Number(age)) && Number(age) > 0 && (
              <Text style={s.agePreview}>Age range: {getAgeRange(Number(age))}</Text>
            )}
          </View>
        </>
      )}

      {/* ── STEP 2: COFFEE FREQUENCY ────────────────────────────────────── */}
      {step === 2 && (
        <View style={s.section}>
          <View style={s.frequencyGroup}>
            {frequencyOptions.map((o) => (
              <TouchableOpacity
                key={o}
                style={[s.frequencyOption, coffeeFrequency === o && s.frequencyOptionSelected]}
                onPress={() => setCoffeeFrequency(o)}
                activeOpacity={0.8}
              >
                <Text style={[s.frequencyText, coffeeFrequency === o && s.frequencyTextSelected]}>
                  {o}
                </Text>
                <View style={[s.frequencyRadio, coffeeFrequency === o && s.frequencyRadioSelected]}>
                  {coffeeFrequency === o && <View style={s.frequencyRadioInner} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── STEP 3: DIETARY RESTRICTIONS ───────────────────────────────── */}
      {step === 3 && (
        <View style={s.section}>
          <View style={s.chipGroup}>
            {dietaryOptions.map((o) => (
              <TouchableOpacity
                key={o}
                style={[s.chip, dietaryRestrictions.includes(o) && s.chipSelected]}
                onPress={() => toggleDietary(o)}
              >
                <Text style={[s.chipText, dietaryRestrictions.includes(o) && s.chipTextSelected]}>
                  {o}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── NAVIGATION BUTTONS ──────────────────────────────────────────── */}
      <View style={s.navRow}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.8}>
            <Text style={s.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}

        {step < TOTAL_STEPS - 1 ? (
          <TouchableOpacity
            style={[s.primaryBtn, step === 0 && !mascotId && s.primaryBtnDisabled]}
            onPress={goNext}
            activeOpacity={0.8}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.primaryBtn, loading && s.primaryBtnDisabled]}
            onPress={handleComplete}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.primaryBtnText}>Complete Setup</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const CELL_SIZE = (SCREEN_WIDTH - 48 - 4 * 10) / 5; // 5 per row, fits 10 in 2 rows

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 24 },

  // Header
  header:     { alignItems: 'center', marginBottom: 28 },
  logoMark:   { width: 56, height: 56, borderRadius: 16, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  logoLetter: { fontSize: 26, fontWeight: '700', color: '#fff' },
  greeting:   { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 4 },
  subtitle:   { fontSize: 14, color: C.textMuted },

  // Progress
  progressRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  progressTrack:{ flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: C.primary, borderRadius: 2 },
  progressLabel:{ fontSize: 12, color: C.textMuted, fontWeight: '500', minWidth: 32 },

  // Step heading
  stepHeading:  { marginBottom: 24 },
  stepTitle:    { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6, lineHeight: 26 },
  stepSubtitle: { fontSize: 13, color: C.textMuted, lineHeight: 19 },

  // ── MASCOT GRID ──────────────────────────────────────────────────────────
  mascotSection: { marginBottom: 24 },

  mascotGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
    marginBottom:  20,
  },

  mascotCell: {
    width:           CELL_SIZE,
    alignItems:      'center',
    paddingVertical: 10,
    borderRadius:    14,
    borderWidth:     1.5,
    borderColor:     C.border,
    backgroundColor: C.surface,
    position:        'relative',
  },
  mascotCellSelected: {
    borderColor:     C.primary,
    backgroundColor: C.primaryMuted,
  },

  mascotAvatar: {
    width:           CELL_SIZE - 16,
    height:          CELL_SIZE - 16,
    borderRadius:    (CELL_SIZE - 16) / 2,
    backgroundColor: C.border,
    justifyContent:  'center',
    alignItems:      'center',
    marginBottom:    6,
  },
  mascotAvatarSelected: {
    backgroundColor: C.primary,
  },
  mascotEmoji: { fontSize: CELL_SIZE * 0.32 },

  mascotName: {
    fontSize:   10,
    fontWeight: '600',
    color:      C.textMuted,
    textAlign:  'center',
  },
  mascotNameSelected: { color: C.primary },

  mascotTick: {
    position:        'absolute',
    top:             6,
    right:           6,
    width:           16,
    height:          16,
    borderRadius:    8,
    backgroundColor: C.primary,
    justifyContent:  'center',
    alignItems:      'center',
  },
  mascotTickText: { fontSize: 9, color: '#fff', fontWeight: '700' },

  // Selected preview banner
  mascotPreview: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            14,
    backgroundColor: C.primaryMuted,
    borderRadius:   14,
    padding:        14,
    borderWidth:    1,
    borderColor:    C.border,
  },
  mascotPreviewAvatar: {
    width:           52,
    height:          52,
    borderRadius:    26,
    backgroundColor: C.primary,
    justifyContent:  'center',
    alignItems:      'center',
  },
  mascotPreviewEmoji: { fontSize: 26 },
  mascotPreviewName:  { fontSize: 16, fontWeight: '700', color: C.primary },
  mascotPreviewSub:   { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  // ── GENERAL SECTIONS ─────────────────────────────────────────────────────
  section:         { marginBottom: 24 },
  sectionLabel:    { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 10 },

  input:      { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  agePreview: { fontSize: 12, color: C.primary, fontWeight: '500', marginTop: 6 },

  chipGroup:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:            { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  chipSelected:    { backgroundColor: C.primary, borderColor: C.primary },
  chipText:        { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  chipTextSelected:{ color: '#fff', fontWeight: '600' },

  // Frequency options (full-width rows)
  frequencyGroup:          { gap: 10 },
  frequencyOption:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderColor: C.border },
  frequencyOptionSelected: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  frequencyText:           { fontSize: 15, fontWeight: '500', color: C.text },
  frequencyTextSelected:   { color: C.primary, fontWeight: '600' },
  frequencyRadio:          { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  frequencyRadioSelected:  { borderColor: C.primary },
  frequencyRadioInner:     { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  // Nav buttons
  navRow:     { flexDirection: 'row', gap: 10, marginTop: 8 },
  backBtn:    { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  backBtnText:{ color: C.textSecondary, fontWeight: '600', fontSize: 15 },
  primaryBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText:     { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },
});