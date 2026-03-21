import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Animated, ScrollView, Modal, FlatList, Image, Alert,
  Dimensions,
} from 'react-native';
import { useAuth } from '@/contexts/auth_context';
import { db } from '@/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { API_BASE_URL } from '@/constants/api';
import {
  schedulePendingRecNotification,
  cancelPendingRecNotification,
  scheduleWelcomeNotification,
} from '@/services/notifications';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

interface PendingRecommendation {
  drink_id:        number;
  name:            string;
  category:        string;
  type:            string;
  caffeine_mg:     number;
  dairy_free:      boolean;
  vegan:           boolean;
  gluten_free:     boolean;
  saved_at:        string;
  mood?:           string | null;
  time_of_day?:    string | null;
  weather?:        string | null;
  is_recommended?: boolean;
}

interface DayStat {
  day: string;
  mg: number;
  count: number;
  over_limit: boolean;
  is_future: boolean;
}

interface UserStats {
  caffeine_by_day: DayStat[];
  total_drinks_this_week: number;
  most_logged_drink: { name: string; log_count: number } | null;
  days_over_limit: number;
}

interface TopRatedDrink {
  name: string;
  category: string;
  avg_rating: number;
  rating_count: number;
}

interface CommunityStats {
  total_community_logs: number;
  most_popular_drink: { name: string; category: string; log_count: number } | null;
  top_rated_drinks: TopRatedDrink[];
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

const getWeekLabel = () => {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon  = new Date(now);
  mon.setDate(now.getDate() - diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)}`;
};

// ─── MINI BAR CHART ──────────────────────────────────────────────────────────

function CaffeineBarChart({
  data,
  limit,
  C,
}: {
  data: DayStat[];
  limit: number | null;
  C: typeof Colors.light;
}) {
  const maxMg   = Math.max(...data.map(d => d.mg), limit ?? 0, 100);
  const barAnims = useRef(data.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animations = data.map((d, i) =>
      Animated.spring(barAnims[i], {
        toValue:         d.is_future ? 0 : d.mg / maxMg,
        useNativeDriver: false,
        tension:         60,
        friction:        10,
        delay:           i * 60,
      })
    );
    Animated.stagger(60, animations).start();
  }, [data]);

  const chartHeight = 120;
  const barActive   = C.primary;
  const barOver     = '#8b3a3a';
  const barFuture   = C.border;
  const limitPct    = limit ? (limit / maxMg) * 100 : null;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: chartHeight, marginBottom: 6 }}>
        <View style={{ width: 36, height: chartHeight, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 6 }}>
          <Text style={{ fontSize: 10, color: C.textMuted }}>{maxMg}mg</Text>
          <Text style={{ fontSize: 10, color: C.textMuted }}>0</Text>
        </View>

        <View style={{ flex: 1, position: 'relative', height: chartHeight }}>
          {[0.25, 0.5, 0.75, 1].map(pct => (
            <View key={pct} style={{
              position: 'absolute', left: 0, right: 0,
              bottom: pct * chartHeight,
              borderTopWidth: 0.5, borderTopColor: C.borderSubtle,
            }} />
          ))}

          {limitPct !== null && (
            <View style={{
              position: 'absolute', left: 0, right: 0,
              bottom: (limitPct / 100) * chartHeight - 1,
              borderTopWidth: 1.5, borderTopColor: '#8b3a3a',
              borderStyle: 'dashed',
              zIndex: 10,
            }} />
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: chartHeight, gap: 6 }}>
            {data.map((d, i) => {
              const color = d.is_future ? barFuture : d.over_limit ? barOver : barActive;
              const heightPct = barAnims[i].interpolate({
                inputRange:  [0, 1],
                outputRange: ['0%', '100%'],
                extrapolate: 'clamp',
              });
              return (
                <View key={d.day} style={{ flex: 1, height: chartHeight, justifyContent: 'flex-end' }}>
                  <Animated.View style={{
                    width: '100%', height: heightPct,
                    backgroundColor: color,
                    borderRadius: 3,
                    minHeight: d.mg > 0 ? 3 : 0,
                  }} />
                </View>
              );
            })}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', paddingLeft: 36 }}>
        {data.map((d) => (
          <Text key={d.day} style={{
            flex: 1, textAlign: 'center', fontSize: 10,
            color: d.is_future ? C.border : C.textMuted, fontWeight: '500',
          }}>{d.day}</Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, paddingLeft: 36 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: barActive }} />
          <Text style={{ fontSize: 11, color: C.textMuted }}>Within limit</Text>
        </View>
        {limit && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: barOver }} />
            <Text style={{ fontSize: 11, color: C.textMuted }}>Over limit</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function Index() {
  const { user } = useAuth();
  const router   = useRouter();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [displayName,   setDisplayName]   = useState('');
  const [loading,       setLoading]       = useState(true);
  const [caffeineLimit, setCaffeineLimit] = useState<number | null>(null);
  const [caffeineMg,    setCaffeineMg]    = useState(0);
  const [barAnim]                         = useState(new Animated.Value(0));

  const [recentDrinks, setRecentDrinks] = useState<LoggedDrink[]>([]);

  const [pendingRec,   setPendingRec]   = useState<PendingRecommendation | null>(null);
  const [loggingDrink, setLoggingDrink] = useState(false);

  const [userStats,      setUserStats]      = useState<UserStats | null>(null);
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [loadingStats,   setLoadingStats]   = useState(false);

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
      loadPendingRec();
      loadStats();
    }, [user])
  );

  const animateBar = (mg: number, limit: number) => {
    Animated.spring(barAnim, {
      toValue:         clamp(mg / limit, 0, 1.2),
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

        // Convert Firestore Timestamp → JS Date for the welcome notification check
        const createdAt: Date | null = data.createdAt?.toDate?.() ?? null;
        scheduleWelcomeNotification(user!.uid, createdAt);
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
      const limitRaw = await AsyncStorage.getItem(`caffeine_limit_${user!.uid}`);
      if (limitRaw) animateBar(todayMg, Number(limitRaw));
    } catch {}
  };

  const loadRecentDrinks = async () => {
    try {
      const stored = await AsyncStorage.getItem(`logged_drinks_${user!.uid}`);
      if (!stored) return;
      const all: LoggedDrink[] = JSON.parse(stored);
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

  const loadPendingRec = async () => {
    try {
      const raw = await AsyncStorage.getItem(`pending_recommendation_${user!.uid}`);
      const rec = raw ? JSON.parse(raw) : null;
      setPendingRec(rec);
    } catch {}
  };

  const loadStats = async () => {
    if (!user) return;
    setLoadingStats(true);
    try {
      const limitRaw   = await AsyncStorage.getItem(`caffeine_limit_${user.uid}`);
      const limitParam = limitRaw ? `?limit=${limitRaw}` : '';

      const [userRes, communityRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/statistics/user/${user.uid}${limitParam}`),
        fetch(`${API_BASE_URL}/api/statistics/community`),
      ]);

      if (userRes.ok)      setUserStats(await userRes.json());
      if (communityRes.ok) setCommunityStats(await communityRes.json());
    } catch (e) {
      console.error('Failed to load stats:', e);
    } finally {
      setLoadingStats(false);
    }
  };

  // ─── PENDING REC ACTIONS ─────────────────────────────────────────────────

  const handleLogPending = async () => {
    if (!user || !pendingRec) return;
    setLoggingDrink(true);
    try {
      const logEntry = {
        ...pendingRec,
        logged_at:      new Date().toISOString(),
        is_recommended: true,
      };
      const storageKey = `logged_drinks_${user.uid}`;
      const raw        = await AsyncStorage.getItem(storageKey);
      const existing   = raw ? JSON.parse(raw) : [];
      const updated    = [logEntry, ...existing];
      await AsyncStorage.setItem(storageKey, JSON.stringify(updated));

      const todayKey = logEntry.logged_at.slice(0, 10);
      const todayMg  = updated
        .filter((d: any) => d.logged_at.slice(0, 10) === todayKey)
        .reduce((sum: number, d: any) => sum + d.caffeine_mg, 0);
      await AsyncStorage.setItem(
        `caffeine_today_${user.uid}`,
        JSON.stringify({ date: todayKey, mg: todayMg })
      );
      setCaffeineMg(todayMg);
      if (caffeineLimit) animateBar(todayMg, caffeineLimit);

      try {
        const savedRes = await fetch(`${API_BASE_URL}/api/logs`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:         user.uid,
            drink_id:        pendingRec.drink_id,
            caffeine_amount: pendingRec.caffeine_mg,
            mood:            pendingRec.mood        ?? null,
            time_of_day:     pendingRec.time_of_day ?? null,
            weather:         pendingRec.weather     ?? null,
            is_recommended:  true,
          }),
        });
        if (savedRes.ok) {
          const savedLog = await savedRes.json();
          const withId = updated.map((d: any) =>
            d.logged_at === logEntry.logged_at && d.drink_id === pendingRec.drink_id
              ? { ...d, log_id: savedLog.log_id }
              : d
          );
          await AsyncStorage.setItem(storageKey, JSON.stringify(withId));
        }
      } catch {}

      await AsyncStorage.removeItem(`pending_recommendation_${user.uid}`);
      setPendingRec(null);
      cancelPendingRecNotification();
      loadRecentDrinks();
      loadStats();
      Alert.alert('Logged!', `${pendingRec.name} has been added to your log.`);
    } catch {
      Alert.alert('Error', 'Could not log this drink. Please try again.');
    } finally {
      setLoggingDrink(false);
    }
  };

  const handleDismissPending = () => {
    Alert.alert(
      'Dismiss recommendation?',
      'This will remove it from your home screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss', style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem(`pending_recommendation_${user!.uid}`);
            setPendingRec(null);
          },
        },
      ]
    );
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
      loadStats();
    } catch (e) { console.error(e); }

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
  const barColor    = isOverLimit ? '#8b3a3a' : ratio > 0.8 ? '#b07d2e' : C.primary;
  const barWidthPct = barAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const renderStars = (rating: number) => {
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  };

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
          source={require('@/assets/images/app_logo2.jpg')}
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
      <TouchableOpacity style={s.quickAddBtn} onPress={openQuickAdd} activeOpacity={0.8}>
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

      {/* ── PENDING RECOMMENDATION / REC CTA ───────────────────────── */}
      {pendingRec ? (
        <View style={s.pendingCard}>
          <View style={s.pendingCardTop}>
            <Text style={s.pendingCardLabel}>YOUR RECOMMENDATION</Text>
            <TouchableOpacity onPress={handleDismissPending} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={s.pendingCardDismiss}>x</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.pendingName}>{pendingRec.name}</Text>
          <Text style={s.pendingMeta}>
            {pendingRec.category}  ·  {pendingRec.type}  ·  {pendingRec.caffeine_mg}mg caffeine
          </Text>
          <Text style={s.pendingPrompt}>Come back after drinking this and log it below.</Text>
          <TouchableOpacity style={s.pendingLogBtn} onPress={handleLogPending} disabled={loggingDrink} activeOpacity={0.8}>
            {loggingDrink
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.pendingLogBtnText}>Log + rate this drink</Text>
            }
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.recCard} onPress={() => router.push('/personalised')} activeOpacity={0.85}>
          <View style={{ flex: 1 }}>
            <Text style={s.recLabel}>Personalised for you</Text>
            <Text style={s.recTitle}>Get a recommendation</Text>
            <Text style={s.recSub}>Answer a few questions and we'll suggest the perfect drink</Text>
          </View>
          <Text style={s.recChevron}>›</Text>
        </TouchableOpacity>
      )}

      {/* ── RECENTLY LOGGED RECOMMENDATIONS ────────────────────────── */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Recently logged recommendations</Text>
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
              style={[s.recentRow, i < recentDrinks.length - 1 && s.recentRowBorder]}
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
          <Text style={s.emptySubtext}>Tap "Log a drink" above to get started</Text>
        </View>
      )}

      {/* ── STATS SECTION ──────────────────────────────────────────── */}
      <View style={s.statsDivider} />

      <View style={s.sectionHeader}>
        <View>
          <Text style={s.sectionTitle}>Your week</Text>
          <Text style={s.statsWeekLabel}>{getWeekLabel()} · resets Monday</Text>
        </View>
      </View>

      {loadingStats ? (
        <View style={s.statsLoading}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={s.statsLoadingText}>Loading stats...</Text>
        </View>
      ) : userStats ? (
        <>
          <View style={s.metricRow}>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Drinks logged</Text>
              <Text style={s.metricValue}>{userStats.total_drinks_this_week}</Text>
              <Text style={s.metricSub}>this week</Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Most logged</Text>
              <Text style={[s.metricValue, { fontSize: 14, paddingTop: 2 }]} numberOfLines={1}>
                {userStats.most_logged_drink?.name ?? '—'}
              </Text>
              <Text style={s.metricSub}>
                {userStats.most_logged_drink
                  ? `${userStats.most_logged_drink.log_count}× this week`
                  : 'no data yet'}
              </Text>
            </View>
          </View>

          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardLabel}>Caffeine this week</Text>
              {userStats.days_over_limit > 0 && (
                <View style={s.overBadge}>
                  <Text style={s.overBadgeText}>
                    {userStats.days_over_limit} day{userStats.days_over_limit > 1 ? 's' : ''} over limit
                  </Text>
                </View>
              )}
            </View>
            <CaffeineBarChart
              data={userStats.caffeine_by_day}
              limit={caffeineLimit}
              C={C}
            />
          </View>
        </>
      ) : (
        <View style={s.statsEmpty}>
          <Text style={s.statsEmptyText}>Log some drinks to see your weekly stats</Text>
        </View>
      )}

      <View style={[s.sectionHeader, { marginTop: 8 }]}>
        <Text style={s.sectionTitle}>Community this week</Text>
      </View>

      {communityStats ? (
        <>
          <View style={s.metricRow}>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Community logs</Text>
              <Text style={s.metricValue}>{communityStats.total_community_logs}</Text>
              <Text style={s.metricSub}>drinks logged total</Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Most popular</Text>
              <Text style={[s.metricValue, { fontSize: 14, paddingTop: 2 }]} numberOfLines={1}>
                {communityStats.most_popular_drink?.name ?? '—'}
              </Text>
              <Text style={s.metricSub}>
                {communityStats.most_popular_drink
                  ? `${communityStats.most_popular_drink.log_count} logs`
                  : 'no data yet'}
              </Text>
            </View>
          </View>

          {communityStats.top_rated_drinks.length > 0 && (
            <View style={s.card}>
              <Text style={[s.cardLabel, { marginBottom: 14 }]}>Top rated this week</Text>
              {communityStats.top_rated_drinks.map((drink, i) => (
                <View
                  key={drink.name}
                  style={[s.rankRow, i < communityStats.top_rated_drinks.length - 1 && s.rankRowBorder]}
                >
                  <View style={s.rankNum}>
                    <Text style={s.rankNumText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rankName}>{drink.name}</Text>
                    <Text style={s.rankMeta}>{drink.category}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.rankStars}>{renderStars(drink.avg_rating)}</Text>
                    <Text style={s.rankCount}>
                      {Number(drink.avg_rating).toFixed(1)} · {drink.rating_count} ratings
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      ) : !loadingStats && (
        <View style={s.statsEmpty}>
          <Text style={s.statsEmptyText}>Community stats unavailable</Text>
        </View>
      )}

      <View style={{ height: 48 }} />

      {/* ── QUICK-ADD MODAL ────────────────────────────────────────── */}
      <Modal animationType="slide" transparent visible={quickAddVisible}
        onRequestClose={() => setQuickAddVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Log a Drink</Text>
              <TouchableOpacity onPress={() => { setQuickAddVisible(false); setSelectedCategory('All'); setFilteredDrinks(allDrinks); }}>
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    style={s.chipBar} contentContainerStyle={s.chipBarContent}>
                    {categories.map((cat) => (
                      <TouchableOpacity key={cat}
                        style={[s.chip, selectedCategory === cat && s.chipActive]}
                        onPress={() => handleCategorySelect(cat)}>
                        <Text style={[s.chipText, selectedCategory === cat && s.chipTextActive]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.drinkRow} onPress={() => handleQuickLog(item)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.drinkRowName}>{item.name}</Text>
                      <Text style={s.drinkRowMeta}>{item.category} · {item.caffeine_mg}mg</Text>
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
  root:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 24, paddingTop: 72 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  greeting:   { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 4 },
  subtitle:   { fontSize: 14, color: C.textMuted },
  logoMark:   { width: 44, height: 44, borderRadius: 12, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },

  card: {
    backgroundColor: C.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardLabel:  { fontSize: 11, fontWeight: '600', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  caffeineStat: { fontSize: 14, fontWeight: '700', color: C.text },
  caffeineOver: { color: '#8b3a3a' },
  barTrack: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  barFill:  { height: 8, borderRadius: 4 },
  barLabel: { fontSize: 12, color: C.textMuted },
  barLabelOver: { color: '#8b3a3a', fontWeight: '600' },

  quickAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  quickAddLeft:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickAddIcon:  { width: 40, height: 40, borderRadius: 10, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
  quickAddPlus:  { fontSize: 24, fontWeight: '300', color: '#fff', lineHeight: 28 },
  quickAddTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  quickAddSub:   { fontSize: 12, color: C.textMuted, marginTop: 1 },
  chevron:       { fontSize: 22, color: C.textMuted },

  pendingCard: {
    backgroundColor: C.surface, borderRadius: 16, padding: 18,
    marginBottom: 28, borderWidth: 1.5, borderColor: C.primary,
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  pendingCardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pendingCardLabel:   { fontSize: 10, fontWeight: '700', color: C.primary, letterSpacing: 0.8 },
  pendingCardDismiss: { fontSize: 14, color: C.textMuted },
  pendingName:        { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 3 },
  pendingMeta:        { fontSize: 13, color: C.textMuted, marginBottom: 10 },
  pendingPrompt:      { fontSize: 13, color: C.textSecondary, lineHeight: 19, marginBottom: 14 },
  pendingLogBtn:      { backgroundColor: C.primary, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  pendingLogBtnText:  { color: '#fff', fontSize: 14, fontWeight: '600' },

  recCard: {
    backgroundColor: C.primary, borderRadius: 16, padding: 20,
    marginBottom: 28, flexDirection: 'row', alignItems: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  recLabel:   { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  recTitle:   { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 5 },
  recSub:     { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18 },
  recChevron: { fontSize: 30, color: 'rgba(255,255,255,0.5)', marginLeft: 8 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:  { fontSize: 15, fontWeight: '700', color: C.text },
  sectionLink:   { fontSize: 13, color: C.primary, fontWeight: '500' },

  recentWrapper: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
    shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1,
    marginBottom: 24,
  },
  recentRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 },
  recentRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  recentLeft:      { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  recentDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, flexShrink: 0 },
  recentName:      { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  recentMeta:      { fontSize: 12, color: C.textMuted },
  recentTime:      { fontSize: 12, color: C.textMuted, flexShrink: 0, marginLeft: 8 },

  emptyState:   { alignItems: 'center', paddingVertical: 36, marginBottom: 24 },
  emptyTitle:   { fontSize: 15, fontWeight: '600', color: C.textSecondary, marginBottom: 4 },
  emptySubtext: { fontSize: 13, color: C.textMuted },

  statsDivider:    { height: 1, backgroundColor: C.border, marginBottom: 24 },
  statsWeekLabel:  { fontSize: 12, color: C.textMuted, marginTop: 2 },
  statsLoading:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20, marginBottom: 14 },
  statsLoadingText:{ fontSize: 13, color: C.textMuted },
  statsEmpty:      { paddingVertical: 20, alignItems: 'center', marginBottom: 14 },
  statsEmptyText:  { fontSize: 13, color: C.textMuted },

  metricRow:   { flexDirection: 'row', gap: 10, marginBottom: 14 },
  metricCard:  { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  metricLabel: { fontSize: 11, color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  metricValue: { fontSize: 22, fontWeight: '700', color: C.text },
  metricSub:   { fontSize: 11, color: C.textMuted, marginTop: 2 },

  overBadge:     { backgroundColor: '#fdecea', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  overBadgeText: { fontSize: 11, color: '#8b3a3a', fontWeight: '600' },

  rankRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rankRowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rankNum:       { width: 24, height: 24, borderRadius: 12, backgroundColor: C.primaryMuted, justifyContent: 'center', alignItems: 'center' },
  rankNumText:   { fontSize: 12, fontWeight: '700', color: C.primary },
  rankName:      { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  rankMeta:      { fontSize: 12, color: C.textMuted },
  rankStars:     { fontSize: 13, color: '#b07d2e' },
  rankCount:     { fontSize: 11, color: C.textMuted, marginTop: 1 },

  modalOverlay:   { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalSheet:     { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle:     { fontSize: 17, fontWeight: '700', color: C.text },
  modalClose:     { fontSize: 20, color: C.textMuted },
  modalCentred:   { padding: 40, alignItems: 'center' },
  modalLoadText:  { marginTop: 12, color: C.textMuted, fontSize: 14 },
  modalErrorText: { color: '#8b3a3a', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn:       { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryText:      { color: '#fff', fontWeight: '600' },

  chipBar:        { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 52 },
  chipBarContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
  chipActive:     { backgroundColor: C.primary, borderColor: C.primary },
  chipText:       { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  drinkRow:     { paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.borderSubtle, flexDirection: 'row', alignItems: 'center' },
  drinkRowName: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  drinkRowMeta: { fontSize: 12, color: C.textMuted },
});