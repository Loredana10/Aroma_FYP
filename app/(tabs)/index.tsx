import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Animated, ScrollView, Modal, FlatList, Image,
} from 'react-native';
import { useAuth } from '@/contexts/auth_context';
import { db } from '@/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { API_BASE_URL } from '@/constants/api';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Drink {
  drink_id: number;
  name: string;
  category: string;
  caffeine_mg: number;
  type: string;
  base: string;
  dairy_free: boolean;
  vegan: boolean;
  gluten_free: boolean;
  milk_alternative_available: boolean;
  shots: number;
}

interface LoggedDrink extends Drink {
  logged_at: string;
  user_rating?: number;
  log_id?: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

const toDateKey = (iso: string) => iso.slice(0, 10);

const formatLoggedTime = (iso: string) => {
  const date    = new Date(iso);
  const today   = toDateKey(new Date().toISOString());
  const dateKey = toDateKey(iso);
  if (dateKey === today) {
    return date.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-IE', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function Index() {
  const { user } = useAuth();
  const router   = useRouter();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  // Profile & caffeine
  const [displayName,   setDisplayName]   = useState('');
  const [loading,       setLoading]       = useState(true);
  const [caffeineLimit, setCaffeineLimit] = useState<number | null>(null);
  const [caffeineMg,    setCaffeineMg]    = useState(0);
  const [barAnim]                         = useState(new Animated.Value(0));

  // Recent drinks
  const [recentDrinks, setRecentDrinks] = useState<LoggedDrink[]>([]);

  // Quick-add modal
  const [quickAddVisible,  setQuickAddVisible]  = useState(false);
  const [allDrinks,        setAllDrinks]        = useState<Drink[]>([]);
  const [filteredDrinks,   setFilteredDrinks]   = useState<Drink[]>([]);
  const [categories,       setCategories]       = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loadingDrinks,    setLoadingDrinks]    = useState(false);
  const [drinksError,      setDrinksError]      = useState<string | null>(null);
  const [userRatings,      setUserRatings]      = useState<Record<number, number>>({});

  // ─── LOAD ON FOCUS ───────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      loadProfile();
      loadCaffeineToday();
      loadRecentDrinks();
    }, [user])
  );

  const animateBar = (mg: number, limit: number) => {
    Animated.spring(barAnim, {
      toValue:        clamp(mg / limit, 0, 1.2),
      useNativeDriver: false,
      tension:         60,
      friction:        8,
    }).start();
  };

  // ─── DATA LOADERS ────────────────────────────────────────────────────────

  const loadProfile = async () => {
    try {
      const snap = await getDoc(doc(db, 'users', user!.uid));
      if (snap.exists()) {
        const data     = snap.data();
        const name     = data.displayName || data.display_name || user?.displayName || '';
        const limitNum = data.caffeineLimit ? Number(data.caffeineLimit) : null;
        setDisplayName(name);
        setCaffeineLimit(limitNum);
        if (limitNum) {
          await AsyncStorage.setItem(`caffeine_limit_${user!.uid}`, String(limitNum));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadCaffeineToday = async () => {
    try {
      const raw = await AsyncStorage.getItem(`caffeine_today_${user!.uid}`);
      if (!raw) return;
      const { date, mg } = JSON.parse(raw);
      const todayMg = toDateKey(new Date().toISOString()) === date ? mg : 0;
      setCaffeineMg(todayMg);
      // read limit from cache so we can animate immediately
      const limitRaw = await AsyncStorage.getItem(`caffeine_limit_${user!.uid}`);
      if (limitRaw) animateBar(todayMg, Number(limitRaw));
    } catch {}
  };

  const loadRecentDrinks = async () => {
    try {
      const stored = await AsyncStorage.getItem(`logged_drinks_${user!.uid}`);
      if (!stored) return;
      const all: LoggedDrink[] = JSON.parse(stored);
      // 3 most recent, de-duplicated by drink name so variety is shown
      const seen = new Set<number>();
      const recent: LoggedDrink[] = [];
      for (const d of all) {
        if (!seen.has(d.drink_id)) {
          seen.add(d.drink_id);
          recent.push(d);
        }
        if (recent.length === 3) break;
      }
      setRecentDrinks(recent);
    } catch {}
  };

  // ─── QUICK ADD ───────────────────────────────────────────────────────────

  const openQuickAdd = async () => {
    setQuickAddVisible(true);
    if (allDrinks.length === 0) fetchDrinks();
    fetchUserRatings();
  };

  const fetchDrinks = async () => {
    setLoadingDrinks(true); setDrinksError(null);
    try {
      const res  = await fetch(`${API_BASE_URL}/api/drinks`);
      if (!res.ok) throw new Error();
      const data: Drink[] = await res.json();
      setAllDrinks(data);
      setFilteredDrinks(data);
      setCategories(['All', ...Array.from(new Set(data.map((d) => d.category)))]);
    } catch {
      setDrinksError('Could not load drinks. Is the server running?');
    } finally {
      setLoadingDrinks(false);
    }
  };

  const fetchUserRatings = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/ratings/${user.uid}`);
      if (!res.ok) return;
      const data: { drink_id: number; star_rating: number }[] = await res.json();
      const map: Record<number, number> = {};
      data.forEach((r) => { map[r.drink_id] = r.star_rating; });
      setUserRatings(map);
    } catch {}
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    setFilteredDrinks(
      cat === 'All' ? allDrinks : allDrinks.filter((d) => d.category === cat)
    );
  };

  const handleQuickLog = async (drink: Drink) => {
    setQuickAddVisible(false);
    setSelectedCategory('All');

    const loggedDrink: LoggedDrink = {
      ...drink,
      logged_at:   new Date().toISOString(),
      user_rating: userRatings[drink.drink_id],
    };

    try {
      const stored   = await AsyncStorage.getItem(`logged_drinks_${user!.uid}`);
      const existing: LoggedDrink[] = stored ? JSON.parse(stored) : [];
      const updated  = [loggedDrink, ...existing];
      await AsyncStorage.setItem(`logged_drinks_${user!.uid}`, JSON.stringify(updated));

      const todayKey = toDateKey(new Date().toISOString());
      const todayMg  = updated
        .filter((d) => toDateKey(d.logged_at) === todayKey)
        .reduce((sum, d) => sum + d.caffeine_mg, 0);
      await AsyncStorage.setItem(
        `caffeine_today_${user!.uid}`,
        JSON.stringify({ date: todayKey, mg: todayMg })
      );

      setCaffeineMg(todayMg);
      if (caffeineLimit) animateBar(todayMg, caffeineLimit);
      loadRecentDrinks();
    } catch (e) { console.error(e); }

    // Persist to PostgreSQL — non-fatal
    if (user) {
      try {
        await fetch(`${API_BASE_URL}/api/logs`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:         user.uid,
            drink_id:        drink.drink_id,
            caffeine_amount: drink.caffeine_mg,
          }),
        });
      } catch {}
    }
  };

  // ─── RENDER HELPERS ──────────────────────────────────────────────────────

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const isOverLimit = caffeineLimit !== null && caffeineMg > caffeineLimit;
  const ratio       = caffeineLimit ? caffeineMg / caffeineLimit : 0;
  const barColor    = isOverLimit ? '#8b3a3a' : ratio > 0.8 ? '#b07d2e' : '#4a7c59';
  const barWidthPct = barAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  // ─── LOADING ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
    >

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.greeting}>
            {greeting()}{displayName ? `, ${displayName}` : ''}
          </Text>
          <Text style={s.subtitle}>What are you having today?</Text>
        </View>
        <Image
          source={require('@/assets/images/app_logo.png')}
          style={s.logoMark}
          resizeMode="contain"
        />
      </View>

      {/* ── CAFFEINE TRACKER ───────────────────────────────────────── */}
      {caffeineLimit !== null && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>Today's Caffeine</Text>
            <Text style={[s.caffeineStat, isOverLimit && s.caffeineOver]}>
              {caffeineMg}mg / {caffeineLimit}mg
            </Text>
          </View>
          <View style={s.barTrack}>
            <Animated.View
              style={[s.barFill, { width: barWidthPct, backgroundColor: barColor }]}
            />
          </View>
          <Text style={[s.barLabel, isOverLimit && s.barLabelOver]}>
            {isOverLimit
              ? 'Over your daily limit'
              : `${caffeineLimit - caffeineMg}mg remaining`}
          </Text>
        </View>
      )}

      {/* ── QUICK ADD ──────────────────────────────────────────────── */}
      <TouchableOpacity
        style={s.quickAddBtn}
        onPress={openQuickAdd}
        activeOpacity={0.8}
      >
        <View style={s.quickAddLeft}>
          <View style={s.quickAddIcon}>
            <Text style={s.quickAddPlus}>+</Text>
          </View>
          <View>
            <Text style={s.quickAddTitle}>Log a drink</Text>
            <Text style={s.quickAddSub}>Tap to add to today's log</Text>
          </View>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>

      {/* ── RECOMMENDATION CTA ─────────────────────────────────────── */}
      <TouchableOpacity
        style={s.recCard}
        onPress={() => router.push('/personalised')}
        activeOpacity={0.85}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.recLabel}>Personalised for you</Text>
          <Text style={s.recTitle}>Get a recommendation</Text>
          <Text style={s.recSub}>
            Answer a few questions and we'll suggest the perfect drink
          </Text>
        </View>
        <Text style={s.recChevron}>›</Text>
      </TouchableOpacity>

      {/* ── RECENT DRINKS ──────────────────────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Recently logged</Text>
        {recentDrinks.length > 0 && (
          <TouchableOpacity onPress={() => router.push('/log')}>
            <Text style={s.sectionLink}>See all</Text>
          </TouchableOpacity>
        )}
      </View>

      {recentDrinks.length > 0 ? (
        <View style={s.recentWrapper}>
          {recentDrinks.map((drink, i) => (
            <View
              key={`${drink.drink_id}_${drink.logged_at}`}
              style={[
                s.recentRow,
                i < recentDrinks.length - 1 && s.recentRowBorder,
              ]}
            >
              <View style={s.recentLeft}>
                <View style={s.recentDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.recentName}>{drink.name}</Text>
                  <Text style={s.recentMeta}>
                    {drink.category} · {drink.caffeine_mg}mg
                    {drink.user_rating ? `  ·  ${drink.user_rating}★` : ''}
                  </Text>
                </View>
              </View>
              <Text style={s.recentTime}>{formatLoggedTime(drink.logged_at)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>No drinks logged yet</Text>
          <Text style={s.emptySubtext}>
            Tap "Log a drink" above to get started
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />

      {/* ── QUICK-ADD MODAL ────────────────────────────────────────── */}
      <Modal
        animationType="slide"
        transparent
        visible={quickAddVisible}
        onRequestClose={() => setQuickAddVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>

            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Log a Drink</Text>
              <TouchableOpacity
                onPress={() => {
                  setQuickAddVisible(false);
                  setSelectedCategory('All');
                  setFilteredDrinks(allDrinks);
                }}
              >
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingDrinks ? (
              <View style={s.modalCentred}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={s.modalLoadText}>Loading drinks...</Text>
              </View>

            ) : drinksError ? (
              <View style={s.modalCentred}>
                <Text style={s.modalErrorText}>{drinksError}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={fetchDrinks}>
                  <Text style={s.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>

            ) : (
              <FlatList
                data={filteredDrinks}
                keyExtractor={(item) => item.drink_id.toString()}
                contentContainerStyle={{ paddingBottom: 32 }}
                stickyHeaderIndices={[0]}
                ListHeaderComponent={
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={s.chipBar}
                    contentContainerStyle={s.chipBarContent}
                  >
                    {categories.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={[s.chip, selectedCategory === cat && s.chipActive]}
                        onPress={() => handleCategorySelect(cat)}
                      >
                        <Text style={[s.chipText, selectedCategory === cat && s.chipTextActive]}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.drinkRow}
                    onPress={() => handleQuickLog(item)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.drinkRowName}>{item.name}</Text>
                      <Text style={s.drinkRowMeta}>
                        {item.category} · {item.caffeine_mg}mg
                      </Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.background,
  },
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 24, paddingTop: 72 },

  // Header
  header:     {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 24,
  },
  greeting:   { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 4 },
  subtitle:   { fontSize: 14, color: C.textMuted },
  logoMark:   {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: C.primary, justifyContent: 'center',
    alignItems: 'center', marginLeft: 12,
  },
  logoLetter: { fontSize: 20, fontWeight: '700', color: '#fff' },

  // Caffeine card
  card: {
    backgroundColor: C.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  cardHeader:   {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  cardLabel:    {
    fontSize: 11, fontWeight: '600', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  caffeineStat: { fontSize: 14, fontWeight: '700', color: C.text },
  caffeineOver: { color: '#8b3a3a' },
  barTrack:     {
    height: 8, backgroundColor: C.border, borderRadius: 4,
    overflow: 'hidden', marginBottom: 8,
  },
  barFill:      { height: 8, borderRadius: 4 },
  barLabel:     { fontSize: 12, color: C.textMuted },
  barLabelOver: { color: '#8b3a3a', fontWeight: '600' },

  // Quick-add button
  quickAddBtn: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: C.surface,
    borderRadius: 14, padding: 16, borderWidth: 1,
    borderColor: C.border, marginBottom: 14,
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  quickAddLeft:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickAddIcon:  {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center',
  },
  quickAddPlus:  { fontSize: 24, fontWeight: '300', color: '#fff', lineHeight: 28 },
  quickAddTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  quickAddSub:   { fontSize: 12, color: C.textMuted, marginTop: 1 },
  chevron:       { fontSize: 22, color: C.textMuted },

  // Recommendation card
  recCard: {
    backgroundColor: C.primary, borderRadius: 16, padding: 20,
    marginBottom: 28, flexDirection: 'row', alignItems: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  recLabel:   {
    fontSize: 11, fontWeight: '600',
    color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase',
    letterSpacing: 0.6, marginBottom: 4,
  },
  recTitle:   { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 5 },
  recSub:     { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18 },
  recChevron: { fontSize: 30, color: 'rgba(255,255,255,0.5)', marginLeft: 8 },

  // Recent section
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  sectionLink:  { fontSize: 13, color: C.primary, fontWeight: '500' },

  recentWrapper: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  recentRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  recentLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  recentDot:   {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: C.primary, flexShrink: 0,
  },
  recentName:  { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  recentMeta:  { fontSize: 12, color: C.textMuted },
  recentTime:  { fontSize: 12, color: C.textMuted, flexShrink: 0, marginLeft: 8 },

  // Empty state
  emptyState:   { alignItems: 'center', paddingVertical: 36 },
  emptyTitle:   { fontSize: 15, fontWeight: '600', color: C.textSecondary, marginBottom: 4 },
  emptySubtext: { fontSize: 13, color: C.textMuted },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, maxHeight: '80%',
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: C.border,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 20,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle:  { fontSize: 17, fontWeight: '700', color: C.text },
  modalClose:  { fontSize: 20, color: C.textMuted },
  modalCentred:{ padding: 40, alignItems: 'center' },
  modalLoadText:  { marginTop: 12, color: C.textMuted, fontSize: 14 },
  modalErrorText: { color: '#8b3a3a', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn:    {
    backgroundColor: C.primary, paddingHorizontal: 24,
    paddingVertical: 10, borderRadius: 20,
  },
  retryText:   { color: '#fff', fontWeight: '600' },

  // Category chips
  chipBar:        {
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 52,
  },
  chipBarContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:           {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.background, borderWidth: 1, borderColor: C.border,
  },
  chipActive:     { backgroundColor: C.primary, borderColor: C.primary },
  chipText:       { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  // Drink rows in modal
  drinkRow: {
    paddingHorizontal: 20, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
    flexDirection: 'row', alignItems: 'center',
  },
  drinkRowName: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  drinkRowMeta: { fontSize: 12, color: C.textMuted },
});