// app/(tabs)/profile.tsx  (was settings.tsx)
import {
  View, Text, Alert, StyleSheet, ScrollView, Modal,
  TextInput, TouchableOpacity, ActivityIndicator, Dimensions,
} from 'react-native';
import { useAuth } from '@/contexts/auth_context';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { MASCOTS, getMascotById } from '@/constants/mascots';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CAFFEINE_REFERENCE = [
  { name: 'Espresso (1 shot)',  mg: 100 },
  { name: 'Double Espresso',    mg: 200 },
  { name: 'Americano',          mg: 200 },
  { name: 'Cappuccino',         mg: 200 },
  { name: 'Latte',              mg: 200 },
  { name: 'Flat White',         mg: 241 },
  { name: 'Cold Brew',          mg: 200 },
  { name: 'Matcha Latte',       mg: 70  },
  { name: 'Chai Latte',         mg: 50  },
  { name: 'Dirty Chai',         mg: 150 },
  { name: 'Decaf (any)',        mg: 2   },
  { name: 'Herbal Tea',         mg: 0   },
];

export default function ProfileScreen() {
  const { user } = useAuth();
  const router   = useRouter();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [editing, setEditing]   = useState(false);

  const [displayName,          setDisplayName]          = useState('');
  const [gender,               setGender]               = useState('');
  const [age,                  setAge]                  = useState('');
  const [dietaryRestrictions,  setDietaryRestrictions]  = useState<string[]>([]);
  const [caffeineLimit,        setCaffeineLimit]        = useState('');
  const [editingCaffeine,      setEditingCaffeine]      = useState(false);
  const [caffeineLimitInput,   setCaffeineLimitInput]   = useState('');
  const [showCaffeineGuide,    setShowCaffeineGuide]    = useState(false);
  const [mascotId,             setMascotId]             = useState<string | null>(null);
  const [showMascotPicker,     setShowMascotPicker]     = useState(false);
  const [pendingMascotId,      setPendingMascotId]      = useState<string | null>(null);

  const genderOptions  = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
  const dietaryOptions = ['None', 'Dairy-free', 'Vegan', 'Gluten-free', 'Nut allergy'];

  useEffect(() => { loadUserProfile(); }, [user]);

  const loadUserProfile = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        setDisplayName(d.displayName || '');
        setGender(d.gender || '');
        setAge(d.age?.toString() || '');
        setDietaryRestrictions(d.dietaryRestrictions || []);
        setMascotId(d.mascotId || null);
        const limit = d.caffeineLimit?.toString() || '';
        setCaffeineLimit(limit);
        setCaffeineLimitInput(limit);
      }
    } catch { Alert.alert('Error', 'Failed to load profile'); }
    finally   { setLoading(false); }
  };

  const toggleDietary = (option: string) => {
    if (option === 'None') { setDietaryRestrictions(['None']); return; }
    setDietaryRestrictions((prev) => {
      const filtered = prev.filter((i) => i !== 'None');
      return prev.includes(option) ? filtered.filter((i) => i !== option) : [...filtered, option];
    });
  };

  const handleSave = async () => {
    if (!gender) { Alert.alert('Missing Information', 'Please select your gender.'); return; }
    if (!age || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) {
      Alert.alert('Invalid Age', 'Please enter a valid age between 1 and 120.'); return;
    }
    if (dietaryRestrictions.length === 0) {
      Alert.alert('Missing Information', 'Please select at least one dietary option.'); return;
    }
    try {
      setSaving(true);
      if (!user) throw new Error('No user found');
      await updateDoc(doc(db, 'users', user.uid), { displayName, gender, age: Number(age), dietaryRestrictions, mascotId });
      Alert.alert('Saved', 'Profile updated successfully.');
      setEditing(false);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const handleSaveCaffeineLimit = async () => {
    if (!user) return;
    const val = caffeineLimitInput.trim();
    if (val === '') {
      await updateDoc(doc(db, 'users', user.uid), { caffeineLimit: null });
      setCaffeineLimit('');
      await AsyncStorage.removeItem(`caffeine_limit_${user.uid}`);
      setEditingCaffeine(false);
      return;
    }
    const num = Number(val);
    if (isNaN(num) || num < 1 || num > 2000) { Alert.alert('Invalid limit', 'Please enter a number between 1 and 2000mg.'); return; }
    try {
      setSaving(true);
      await updateDoc(doc(db, 'users', user.uid), { caffeineLimit: num });
      await AsyncStorage.setItem(`caffeine_limit_${user.uid}`, String(num));
      setCaffeineLimit(String(num));
      setEditingCaffeine(false);
      Alert.alert('Saved', `Daily caffeine limit set to ${num}mg`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const handleSaveMascot = async () => {
    if (!pendingMascotId || !user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { mascotId: pendingMascotId });
      setMascotId(pendingMascotId);
      setShowMascotPicker(false);
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await signOut(auth); router.replace('/(auth)/signin'); }
        catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  if (loading) {
    return <View style={s.loadingContainer}><ActivityIndicator size="large" color={C.primary} /></View>;
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll}>

      {/* Mascot header */}
      <MascotHeader
        mascotId={mascotId}
        displayName={displayName}
        onChangeMascot={() => { setPendingMascotId(mascotId); setShowMascotPicker(true); }}
      />

      {/* Mascot picker modal */}
      <Modal
        animationType="slide"
        transparent
        visible={showMascotPicker}
        onRequestClose={() => setShowMascotPicker(false)}
      >
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Choose your mascot</Text>
              <TouchableOpacity onPress={() => setShowMascotPicker(false)}>
                <Text style={s.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.pickerScroll} showsVerticalScrollIndicator={false}>
              <View style={s.pickerGrid}>
                {MASCOTS.map((mascot) => {
                  const isSelected = pendingMascotId === mascot.id;
                  return (
                    <TouchableOpacity
                      key={mascot.id}
                      style={[s.pickerCell, isSelected && s.pickerCellSelected]}
                      onPress={() => setPendingMascotId(mascot.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[s.pickerAvatar, isSelected && s.pickerAvatarSelected]}>
                        <Text style={s.pickerEmoji}>{mascot.placeholder}</Text>
                      </View>
                      <Text style={[s.pickerName, isSelected && s.pickerNameSelected]}>
                        {mascot.name}
                      </Text>
                      {isSelected && (
                        <View style={s.pickerTick}>
                          <Text style={s.pickerTickText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Preview of selected */}
              {pendingMascotId && (() => {
                const m = getMascotById(pendingMascotId);
                return m ? (
                  <View style={s.pickerPreview}>
                    <View style={s.pickerPreviewAvatar}>
                      <Text style={s.pickerPreviewEmoji}>{m.placeholder}</Text>
                    </View>
                    <View>
                      <Text style={s.pickerPreviewName}>{m.name}</Text>
                      <Text style={s.pickerPreviewSub}>Your new mascot</Text>
                    </View>
                  </View>
                ) : null;
              })()}
            </ScrollView>

            <View style={s.pickerActions}>
              <TouchableOpacity style={s.pickerCancelBtn} onPress={() => setShowMascotPicker(false)}>
                <Text style={s.pickerCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.pickerSaveBtn, !pendingMascotId && s.pickerSaveBtnDisabled]}
                onPress={handleSaveMascot}
                disabled={!pendingMascotId}
                activeOpacity={0.8}
              >
                <Text style={s.pickerSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Account */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Email</Text>
          <Text style={s.infoValue}>{user?.email}</Text>
        </View>
      </View>

      {/* Profile Details */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Personal Details</Text>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={s.editLink}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {editing ? (
          <>
            <Text style={s.fieldLabel}>Display Name</Text>
            <TextInput
              placeholder="Your name" placeholderTextColor={C.textMuted}
              value={displayName} onChangeText={setDisplayName} style={s.input}
            />
            <Text style={s.fieldLabel}>Gender</Text>
            <View style={s.chipGroup}>
              {genderOptions.map((o) => (
                <TouchableOpacity key={o} style={[s.chip, gender === o && s.chipSelected]} onPress={() => setGender(o)}>
                  <Text style={[s.chipText, gender === o && s.chipTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.fieldLabel}>Age</Text>
            <TextInput
              placeholder="Enter your age" placeholderTextColor={C.textMuted} keyboardType="number-pad"
              value={age} onChangeText={setAge} style={s.input} maxLength={3}
            />
            <Text style={s.fieldLabel}>Dietary Restrictions</Text>
            <View style={s.chipGroup}>
              {dietaryOptions.map((o) => (
                <TouchableOpacity key={o} style={[s.chip, dietaryRestrictions.includes(o) && s.chipSelected]} onPress={() => toggleDietary(o)}>
                  <Text style={[s.chipText, dietaryRestrictions.includes(o) && s.chipTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.buttonRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setEditing(false); loadUserProfile(); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            {[
              ['Name',                 displayName || 'Not set'],
              ['Gender',               gender || 'Not set'],
              ['Age',                  age || 'Not set'],
              ['Dietary Restrictions', dietaryRestrictions.length > 0 ? dietaryRestrictions.join(', ') : 'Not set'],
            ].map(([label, val]) => (
              <View key={label} style={s.infoRow}>
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue}>{val}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Caffeine Limit */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Daily Caffeine Limit</Text>
          {!editingCaffeine && (
            <TouchableOpacity onPress={() => setEditingCaffeine(true)}>
              <Text style={s.editLink}>{caffeineLimit ? 'Edit' : 'Set'}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.sectionDescription}>
          Set an optional daily limit. A progress bar will appear on your home screen as you log drinks.
        </Text>
        {caffeineLimit ? (
          <View style={s.limitBadge}>
            <Text style={s.limitBadgeText}>Current limit: {caffeineLimit}mg / day</Text>
          </View>
        ) : (
          <Text style={s.noLimitText}>No limit set</Text>
        )}
        {editingCaffeine && (
          <>
            <TextInput
              placeholder="e.g. 400" placeholderTextColor={C.textMuted} keyboardType="number-pad"
              value={caffeineLimitInput} onChangeText={setCaffeineLimitInput}
              style={[s.input, { marginTop: 12 }]} maxLength={4}
            />
            <Text style={s.hintText}>Leave blank and save to remove the limit.</Text>
            <View style={s.buttonRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setEditingCaffeine(false); setCaffeineLimitInput(caffeineLimit); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDisabled]} onPress={handleSaveCaffeineLimit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity style={s.guideToggle} onPress={() => setShowCaffeineGuide((v) => !v)}>
          <Text style={s.guideToggleText}>
            {showCaffeineGuide ? 'Hide caffeine guide' : 'View caffeine guide'}
          </Text>
        </TouchableOpacity>

        {showCaffeineGuide && (
          <View style={s.guideBox}>
            {CAFFEINE_REFERENCE.map((item) => (
              <View key={item.name} style={s.guideRow}>
                <Text style={s.guideDrink}>{item.name}</Text>
                <Text style={[s.guideMg,
                  item.mg === 0 ? s.guideMgZero : item.mg >= 200 ? s.guideMgHigh : s.guideMgMed
                ]}>{item.mg}mg</Text>
              </View>
            ))}
            <Text style={s.guideNote}>400mg limit ≈ 2 lattes or 4 espressos per day.</Text>
          </View>
        )}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={s.logoutBtnText}>Sign out</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}


// ─── MASCOT HEADER COMPONENT ─────────────────────────────────────────────────

function MascotHeader({ mascotId, displayName, onChangeMascot }: {
  mascotId: string | null;
  displayName: string;
  onChangeMascot: () => void;
}) {
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const mascot = mascotId ? getMascotById(mascotId) : null;
  const ms = mhStyles(C);

  return (
    <View style={ms.mascotHeader}>
      {/* Avatar column — circle + button stacked */}
      <View style={ms.mascotAvatarCol}>
        <View style={[ms.mascotAvatarCircle, !mascot && ms.mascotAvatarCircleFallback]}>
          {mascot
            ? <Text style={ms.mascotEmoji}>{mascot.placeholder}</Text>
            : <Text style={ms.mascotFallbackLetter}>
                {displayName ? displayName[0].toUpperCase() : 'A'}
              </Text>
          }
        </View>
        <TouchableOpacity style={ms.changeMascotBtn} onPress={onChangeMascot} activeOpacity={0.8}>
          <Text style={ms.changeMascotBtnText}>Change</Text>
        </TouchableOpacity>
      </View>

      {/* Name + mascot name */}
      <View style={ms.mascotHeaderText}>
        <Text style={ms.mascotHeaderName}>{displayName || 'Your profile'}</Text>
        {mascot
          ? <Text style={ms.mascotHeaderSub}>{mascot.name}</Text>
          : <Text style={ms.mascotHeaderSubMuted}>No mascot selected</Text>
        }
      </View>
    </View>
  );
}

const mhStyles = (C: typeof Colors.light) => StyleSheet.create({
  mascotHeader:               { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28 },
  mascotAvatarCol:            { alignItems: 'center', gap: 8 },
  mascotAvatarCircle:         { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  mascotAvatarCircleFallback: { backgroundColor: C.border },
  mascotEmoji:                { fontSize: 34 },
  mascotFallbackLetter:       { fontSize: 30, fontWeight: '700', color: '#fff' },
  changeMascotBtn:            { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  changeMascotBtnText:        { fontSize: 11, color: C.primary, fontWeight: '600' },
  mascotHeaderText:           { flex: 1 },
  mascotHeaderName:           { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 3 },
  mascotHeaderSub:            { fontSize: 14, color: C.primary, fontWeight: '600' },
  mascotHeaderSubMuted:       { fontSize: 13, color: C.textMuted, fontStyle: 'italic' },
});

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { padding: 24, paddingTop: 64 },

  pageTitle: { fontSize: 28, fontWeight: '700', color: C.text, marginBottom: 28 },

  section:     { backgroundColor: C.surface, borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle:  { fontSize: 15, fontWeight: '600', color: C.text },
  sectionDescription: { fontSize: 13, color: C.textMuted, lineHeight: 19, marginBottom: 12 },
  editLink:    { color: C.primary, fontSize: 14, fontWeight: '600' },

  infoRow:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  infoLabel: { fontSize: 12, color: C.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoValue: { fontSize: 15, color: C.text, fontWeight: '500' },

  fieldLabel: { fontSize: 13, fontWeight: '500', color: C.textSecondary, marginTop: 14, marginBottom: 6 },
  input:      { backgroundColor: C.background, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },

  chipGroup:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip:             { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.background },
  chipSelected:     { backgroundColor: C.primary, borderColor: C.primary },
  chipText:         { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },

  buttonRow:      { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn:      { flex: 1, backgroundColor: C.background, borderWidth: 1, borderColor: C.border, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtnText:  { color: C.textSecondary, fontWeight: '600' },
  saveBtn:        { flex: 1, backgroundColor: C.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnDisabled:{ opacity: 0.6 },
  saveBtnText:    { color: '#fff', fontWeight: '600' },

  limitBadge:     { backgroundColor: C.primaryMuted, borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 8 },
  limitBadgeText: { color: C.primary, fontWeight: '700', fontSize: 14 },
  noLimitText:    { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 },
  hintText:       { fontSize: 12, color: C.textMuted, marginBottom: 8 },

  guideToggle:     { marginTop: 12, paddingVertical: 6 },
  guideToggleText: { color: C.primary, fontSize: 13, fontWeight: '500' },
  guideBox:        { marginTop: 8, backgroundColor: C.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border },
  guideRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  guideDrink:      { fontSize: 13, color: C.textSecondary },
  guideMg:         { fontSize: 13, fontWeight: '600' },
  guideMgZero:     { color: C.textMuted },
  guideMgMed:      { color: '#b07d2e' },
  guideMgHigh:     { color: '#8b3a3a' },
  guideNote:       { fontSize: 12, color: C.textMuted, marginTop: 8, fontStyle: 'italic' },

  logoutBtn:     { backgroundColor: C.surface, borderWidth: 1, borderColor: '#8b3a3a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  logoutBtnText: { color: '#8b3a3a', fontSize: 15, fontWeight: '600' },



  // Mascot picker modal
  pickerOverlay:  { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  pickerSheet:    { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  pickerHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerTitle:    { fontSize: 17, fontWeight: '700', color: C.text },
  pickerClose:    { fontSize: 20, color: C.textMuted, padding: 4 },
  pickerScroll:   { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },

  pickerGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  pickerCell:     { width: (Dimensions.get('window').width - 80) / 5, alignItems: 'center', paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background, position: 'relative' },
  pickerCellSelected: { borderColor: C.primary, backgroundColor: C.primaryMuted },

  pickerAvatar:         { width: (Dimensions.get('window').width - 80) / 5 - 16, height: (Dimensions.get('window').width - 80) / 5 - 16, borderRadius: ((Dimensions.get('window').width - 80) / 5 - 16) / 2, backgroundColor: C.border, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  pickerAvatarSelected: { backgroundColor: C.primary },
  pickerEmoji:          { fontSize: 20 },
  pickerName:           { fontSize: 10, fontWeight: '600', color: C.textMuted, textAlign: 'center' },
  pickerNameSelected:   { color: C.primary },
  pickerTick:           { position: 'absolute', top: 5, right: 5, width: 15, height: 15, borderRadius: 8, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  pickerTickText:       { fontSize: 8, color: '#fff', fontWeight: '700' },

  pickerPreview:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.primaryMuted, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  pickerPreviewAvatar:{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  pickerPreviewEmoji: { fontSize: 24 },
  pickerPreviewName:  { fontSize: 15, fontWeight: '700', color: C.primary },
  pickerPreviewSub:   { fontSize: 12, color: C.textSecondary, marginTop: 1 },

  pickerActions:      { flexDirection: 'row', gap: 10, padding: 20, borderTopWidth: 1, borderTopColor: C.border },
  pickerCancelBtn:    { flex: 1, backgroundColor: C.background, borderWidth: 1, borderColor: C.border, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  pickerCancelText:   { color: C.textSecondary, fontWeight: '600', fontSize: 15 },
  pickerSaveBtn:      { flex: 2, backgroundColor: C.primary, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  pickerSaveBtnDisabled: { opacity: 0.4 },
  pickerSaveText:     { color: '#fff', fontWeight: '700', fontSize: 15 },

});