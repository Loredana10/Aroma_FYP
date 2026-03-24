import { API_BASE_URL } from '@/constants/api';
import {
  scheduleUnratedLogNotification,
  cancelUnratedLogNotification,
  scheduleCaffeineLimitNotification,
} from '@/services/notifications';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth_context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal,
  ScrollView, SectionList, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Drink {
  drink_id: number; name: string; category: string; type: string;
  base: string; caffeine_mg: number; shots: number;
  dairy_free: boolean; vegan: boolean; gluten_free: boolean;
  milk_alternative_available: boolean;
}

interface LogContext {
  mood?:        string;
  time_of_day?: string;
  weather?:     string;
}

interface LoggedDrink extends Drink {
  logged_at: string; user_rating?: number; log_id?: number;
  is_recommended?: boolean;
  mood?: string; time_of_day?: string; weather?: string;
}

interface DrinkAverage {
  drink_id: number; avg_rating: number; rating_count: number;
}

interface DaySection {
  title: string; dateKey: string; totalCaffeine: number; data: LoggedDrink[];
}

// ─── CONTEXT OPTIONS ─────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: 'Tired and need a boost',         label: 'Need a boost' },
  { value: 'Fairly okay, just want a drink', label: 'Just fancy a drink'},
  { value: 'Relaxed and winding down',       label: 'Winding down'},
];

const TIME_OPTIONS = [
  { value: 'Morning',   label: 'Morning'},
  { value: 'Afternoon', label: 'Afternoon'},
  { value: 'Evening',   label: 'Evening'},
];

const WEATHER_OPTIONS = [
  { value: 'Hot/Warm', label: 'Warm'},
  { value: 'Cold',     label: 'Cold'},
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const toDateKey = (iso: string) => iso.slice(0, 10);

const formatSectionTitle = (dateKey: string) => {
  const today     = toDateKey(new Date().toISOString());
  const yesterday = toDateKey(new Date(Date.now() - 86400000).toISOString());
  if (dateKey === today)     return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  return new Date(dateKey).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
};

const groupByDay = (drinks: LoggedDrink[]): DaySection[] => {
  const map: Record<string, LoggedDrink[]> = {};
  drinks.forEach((d) => {
    const key = toDateKey(d.logged_at);
    if (!map[key]) map[key] = [];
    map[key].push(d);
  });
  return Object.keys(map).sort((a, b) => b.localeCompare(a)).map((key) => ({
    title: formatSectionTitle(key), dateKey: key,
    totalCaffeine: map[key].reduce((s, d) => s + d.caffeine_mg, 0),
    data: map[key],
  }));
};

const getCurrentWeekSections = (sections: DaySection[]) => {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return sections.filter((s) => new Date(s.dateKey) >= monday);
};

// ─── STARS ───────────────────────────────────────────────────────────────────

const Stars = ({
  rating, size = 16, interactive = false, onRate, activeColor,
}: { rating: number; size?: number; interactive?: boolean; onRate?: (r: number) => void; activeColor: string }) => (
  <View style={{ flexDirection: 'row', gap: 2 }}>
    {[1,2,3,4,5].map((star) => (
      <TouchableOpacity key={star} disabled={!interactive} onPress={() => onRate?.(star)} activeOpacity={0.7}>
        <Text style={{ fontSize: size, color: star <= Math.round(rating) ? activeColor : '#d0d0d0' }}>★</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ─── CONTEXT PILL ROW ────────────────────────────────────────────────────────

function ContextPillRow({ options, selected, onSelect, s }: {
  options: { value: string; label: string}[];
  selected: string | undefined;
  onSelect: (v: string) => void;
  s: any;
}) {
  return (
    <View style={s.pillRow}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[s.pill, selected === o.value && s.pillSelected]}
          onPress={() => onSelect(selected === o.value ? '' : o.value)}
          activeOpacity={0.8}
        >
          <Text style={[s.pillText, selected === o.value && s.pillTextSelected]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export default function LogScreen() {
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [loggedDrinks,     setLoggedDrinks]     = useState<LoggedDrink[]>([]);
  const [allDrinks,        setAllDrinks]        = useState<Drink[]>([]);
  const [filteredDrinks,   setFilteredDrinks]   = useState<Drink[]>([]);
  const [categories,       setCategories]       = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [averages,         setAverages]         = useState<Record<number, DrinkAverage>>({});
  const [showWeekOnly,     setShowWeekOnly]     = useState(true);
  const [loadingLogs,      setLoadingLogs]      = useState(false);

  // Add drink modal
  const [addModalVisible,  setAddModalVisible]  = useState(false);
  const [selectedDrink,    setSelectedDrink]    = useState<Drink | null>(null);
  const [loadingDrinks,    setLoadingDrinks]    = useState(false);
  const [drinksError,      setDrinksError]      = useState<string | null>(null);

  // Context modal
  const [contextModalVisible, setContextModalVisible] = useState(false);
  const [drinkToLog,          setDrinkToLog]          = useState<Drink | null>(null);
  const [pendingMood,         setPendingMood]         = useState<string>('');
  const [pendingTime,         setPendingTime]         = useState<string>('');
  const [pendingWeather,      setPendingWeather]      = useState<string>('');

  // Rating modal
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [drinkToRate,        setDrinkToRate]        = useState<LoggedDrink | null>(null);
  const [pendingRating,      setPendingRating]      = useState(0);
  const [savingRating,       setSavingRating]       = useState(false);

  // ─── LOAD ────────────────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      loadLogsAndRatings();
      fetchAverages();
    }, [user])
  );

  useEffect(() => {
    if (addModalVisible && allDrinks.length === 0) fetchDrinks();
  }, [addModalVisible]);

  useEffect(() => {
    setFilteredDrinks(
      selectedCategory === 'All' ? allDrinks : allDrinks.filter((d) => d.category === selectedCategory)
    );
  }, [selectedCategory, allDrinks]);

  // ─── API ─────────────────────────────────────────────────────────────────

  const fetchDrinks = async () => {
    setLoadingDrinks(true); setDrinksError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drinks`);
      if (!res.ok) throw new Error();
      const data: Drink[] = await res.json();
      setAllDrinks(data); setFilteredDrinks(data);
      setCategories(['All', ...Array.from(new Set(data.map((d) => d.category)))]);
    } catch { setDrinksError('Could not load drinks. Is the server running?'); }
    finally  { setLoadingDrinks(false); }
  };

  const fetchAverages = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ratings/averages`);
      if (!res.ok) return;
      const data: DrinkAverage[] = await res.json();
      const map: Record<number, DrinkAverage> = {};
      data.forEach((d) => { map[d.drink_id] = d; });
      setAverages(map);
    } catch {}
  };

  const submitRating = async (logEntry: LoggedDrink, rating: number) => {
    if (!user) return;
    setSavingRating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ratings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:     user.uid,
          drink_id:    logEntry.drink_id,
          log_id:      logEntry.log_id ?? null,
          star_rating: rating,
          mood:        logEntry.mood        ?? null,
          time_of_day: logEntry.time_of_day ?? null,
          weather:     logEntry.weather     ?? null,
        }),
      });
      if (!res.ok) throw new Error();
      // Update only the specific log entry that was rated (matched by log_id)
      const updated = loggedDrinks.map((d) =>
        d.log_id === logEntry.log_id ? { ...d, user_rating: rating } : d
      );
      setLoggedDrinks(updated);
      updateCaffeineCache(updated);
      fetchAverages();
      // Re-count unrated drinks — cancels notification if all are now rated
      updateUnratedNotification(updated);
    } catch { Alert.alert('Error', 'Could not save rating. Please try again.'); }
    finally  { setSavingRating(false); }
  };

  // ─── LOAD LOGS + RATINGS FROM DB ─────────────────────────────────────────

  /**
   * Fetches logs AND the user's personal ratings from the DB in parallel,
   * then merges ratings onto the matching log entries by drink_id.
   * This ensures user_rating is always populated from PostgreSQL — not AsyncStorage —
   * so data persists across devices and reinstalls.
   */
  const loadLogsAndRatings = async () => {
    if (!user) return;
    setLoadingLogs(true);
    try {
      // Fetch logs and user ratings in parallel
      const [logsRes, ratingsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/logs/${user.uid}`),
        fetch(`${API_BASE_URL}/api/ratings/user/${user.uid}`),
      ]);

      // Build TWO lookup maps from the user's ratings:
      // 1. log_id → star_rating  (exact match — most reliable)
      // 2. drink_id → star_rating (fallback for ratings saved without a log_id)
      const ratingsByLogId: Record<number, number> = {};
      const ratingsByDrinkId: Record<number, number> = {};
      if (ratingsRes.ok) {
        const ratingsData = await ratingsRes.json();
        ratingsData.forEach((r: any) => {
          if (r.log_id && r.star_rating) {
            ratingsByLogId[r.log_id] = r.star_rating;
          }
          // Keep the most recent rating per drink as a fallback
          if (r.drink_id && r.star_rating) {
            ratingsByDrinkId[r.drink_id] = r.star_rating;
          }
        });
      }

      if (!logsRes.ok) throw new Error('Failed to fetch logs');
      const rows = await logsRes.json();

      // Track which drink_ids we've already applied the fallback rating to.
      // This ensures only the FIRST (most recent) log of a drink gets the
      // drink-level fallback — subsequent logs of the same drink stay unrated.
      const drinkRatingApplied = new Set<number>();

      const drinks: LoggedDrink[] = rows.map((row: any) => {
        // Priority: exact log_id match > drink_id fallback (first occurrence only)
        let userRating: number | undefined = undefined;
        if (row.log_id && ratingsByLogId[row.log_id] != null) {
          userRating = ratingsByLogId[row.log_id];
        } else if (!drinkRatingApplied.has(row.drink_id) && ratingsByDrinkId[row.drink_id] != null) {
          userRating = ratingsByDrinkId[row.drink_id];
          drinkRatingApplied.add(row.drink_id);
        }

        return {
          drink_id:                   row.drink_id,
          name:                       row.drink_name ?? row.name,
          category:                   row.category,
          type:                       row.type        ?? '',
          base:                       row.base        ?? '',
          caffeine_mg:                row.caffeine_amount ?? row.caffeine_mg ?? 0,
          shots:                      row.shots       ?? 0,
          dairy_free:                 row.dairy_free  ?? false,
          vegan:                      row.vegan       ?? false,
          gluten_free:                row.gluten_free ?? false,
          milk_alternative_available: row.milk_alternative_available ?? false,
          log_id:                     row.log_id,
          logged_at:                  row.timestamp ?? row.logged_at,
          user_rating:                userRating,
          is_recommended:             row.is_recommended ?? false,
          mood:                       row.mood        ?? undefined,
          time_of_day:                row.time_of_day ?? undefined,
          weather:                    row.weather     ?? undefined,
        };
      });

      setLoggedDrinks(drinks);
      updateCaffeineCache(drinks);
    } catch (e) {
      console.error('Error loading logs from DB:', e);
      // Fallback to AsyncStorage cache if server is unreachable
      try {
        const stored = await AsyncStorage.getItem(`logged_drinks_${user.uid}`);
        if (stored) setLoggedDrinks(JSON.parse(stored));
      } catch {}
    } finally {
      setLoadingLogs(false);
    }
  };

  /**
   * Counts unrated drinks across ALL log entries (unique by drink_id),
   * then schedules or cancels the unrated notification accordingly.
   * Called after every log add, rating save, or delete.
   */
  const updateUnratedNotification = async (drinks: LoggedDrink[]) => {
    // Count unique drink_ids that have no rating
    const unratedDrinkIds = new Set(
      drinks
        .filter((d) => d.user_rating == null)
        .map((d) => d.drink_id)
    );
    const count = unratedDrinkIds.size;

    if (count === 0) {
      cancelUnratedLogNotification();
    } else {
      scheduleUnratedLogNotification(count);
    }
  };
  const updateCaffeineCache = async (drinks: LoggedDrink[]) => {
    if (!user) return;
    try {
      const todayKey = toDateKey(new Date().toISOString());
      const todayMg  = drinks
        .filter((d) => toDateKey(d.logged_at) === todayKey)
        .reduce((s, d) => s + d.caffeine_mg, 0);
      await AsyncStorage.setItem(`caffeine_today_${user.uid}`, JSON.stringify({ date: todayKey, mg: todayMg }));

      // Strip user_rating before writing to AsyncStorage.
      // Ratings are always loaded fresh from PostgreSQL by loadLogsAndRatings —
      // persisting them in the cache causes the home screen's "Log a drink" flow
      // to pre-fill ratings on new log entries for previously-rated drinks.
      const toCache = drinks.map(({ user_rating, ...rest }) => rest);
      await AsyncStorage.setItem(`logged_drinks_${user.uid}`, JSON.stringify(toCache));

      const limitRaw = await AsyncStorage.getItem(`caffeine_limit_${user.uid}`);
      const limit    = limitRaw ? parseInt(limitRaw) : null;
      if (limit && todayMg > limit) {
        scheduleCaffeineLimitNotification(limit, todayMg);
      }
    } catch (e) { console.error(e); }
  };

  // ─── HANDLERS ────────────────────────────────────────────────────────────

  const handleDrinkSelected = (drink: Drink) => {
    setDrinkToLog(drink);
    setPendingMood('');
    setPendingTime('');
    setPendingWeather('');
    setAddModalVisible(false);
    setSelectedDrink(null);
    setSelectedCategory('All');
    setContextModalVisible(true);
  };

  const handleConfirmLog = async () => {
    if (!drinkToLog) return;
    setContextModalVisible(false);
    const ctx: LogContext = {
      mood:        pendingMood    || undefined,
      time_of_day: pendingTime   || undefined,
      weather:     pendingWeather || undefined,
    };
    await doAddDrink(drinkToLog, ctx, false);
    setDrinkToLog(null);
  };

  const doAddDrink = async (drink: Drink, ctx: LogContext, isRecommended: boolean) => {
    if (!user) return;

    // New log entries always start unrated — rating is per-log, not per-drink
    const optimisticEntry: LoggedDrink = {
      ...drink,
      logged_at:      new Date().toISOString(),
      user_rating:    undefined,
      is_recommended: isRecommended,
      mood:           ctx.mood,
      time_of_day:    ctx.time_of_day,
      weather:        ctx.weather,
    };

    const optimistic = [optimisticEntry, ...loggedDrinks];
    setLoggedDrinks(optimistic);
    updateCaffeineCache(optimistic);

    try {
      const res = await fetch(`${API_BASE_URL}/api/logs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:         user.uid,
          drink_id:        drink.drink_id,
          caffeine_amount: drink.caffeine_mg,
          mood:            ctx.mood           || null,
          time_of_day:     ctx.time_of_day    || null,
          weather:         ctx.weather        || null,
          is_recommended:  isRecommended,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        const withId = optimistic.map((d) =>
          d.logged_at === optimisticEntry.logged_at && d.drink_id === drink.drink_id
            ? { ...d, log_id: saved.log_id }
            : d
        );
        setLoggedDrinks(withId);
        updateCaffeineCache(withId);
        // Schedule/update unrated notification with the new count
        updateUnratedNotification(withId);
      }
    } catch (e) { console.error('Failed to save log to DB:', e); }
  };

  const handleAddDrink = (drink: Drink) => {
    handleDrinkSelected(drink);
  };

  const handleDeleteDrink = (drink: LoggedDrink) => {
    Alert.alert('Remove Drink', `Remove ${drink.name} from your log?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        // Optimistically remove from UI
        const updated = loggedDrinks.filter((d) =>
          !(d.log_id === drink.log_id && d.logged_at === drink.logged_at)
        );
        setLoggedDrinks(updated);
        updateCaffeineCache(updated);
        updateUnratedNotification(updated);

        if (drink.log_id) {
          try {
            const res = await fetch(`${API_BASE_URL}/api/logs/${drink.log_id}`, { method: 'DELETE' });
            if (!res.ok) {
              // DB delete failed — reload from DB so the entry comes back
              // rather than showing a ghost deleted state
              console.error('Delete failed, reloading from DB');
              loadLogsAndRatings();
            }
          } catch {
            // Network error — reload from DB to stay in sync
            loadLogsAndRatings();
          }
        } else {
          // No log_id means this entry was never saved to DB (optimistic only)
          // Nothing to delete server-side
        }
      }},
    ]);
  };

  const openRatingModal = (drink: LoggedDrink) => {
    setDrinkToRate(drink); setPendingRating(drink.user_rating ?? 0); setRatingModalVisible(true);
  };

  const handleConfirmRating = async () => {
    if (!drinkToRate || pendingRating === 0) { Alert.alert('Select a rating', 'Please tap a star to give a rating.'); return; }
    await submitRating(drinkToRate, pendingRating);
    setRatingModalVisible(false); setDrinkToRate(null);
  };

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });

  // ─── SECTION DATA ─────────────────────────────────────────────────────────

  const allSections  = groupByDay(loggedDrinks);
  const weekSections = getCurrentWeekSections(allSections);
  const sections     = showWeekOnly ? weekSections : allSections;
  const totalToday   = allSections.find((s) => s.title === 'Today')?.totalCaffeine ?? 0;

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const renderDrinkCard = ({ item }: { item: LoggedDrink }) => {
    const avg = averages[item.drink_id];
    return (
      <View style={s.drinkCard}>
        <View style={s.cardTop}>
          <View style={{ flex: 1 }}>
            {item.is_recommended && (
              <View style={s.recTag}><Text style={s.recTagText}>✨ Recommended</Text></View>
            )}
            <Text style={s.cardName}>{item.name}</Text>
            <Text style={s.cardMeta}>{item.category} · {item.caffeine_mg}mg</Text>
            {(item.mood || item.time_of_day || item.weather) && (
              <View style={s.cardContextRow}>
                {item.mood        && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{item.mood.split(' ')[0]}</Text></View>}
                {item.time_of_day && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{item.time_of_day}</Text></View>}
                {item.weather     && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{item.weather}</Text></View>}
              </View>
            )}
          </View>
          <View style={s.cardRight}>
            <Text style={s.cardTime}>{formatTime(item.logged_at)}</Text>
            <TouchableOpacity onPress={() => handleDeleteDrink(item)}>
              <Text style={s.deleteBtn}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.cardBottom}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {avg
              ? <><Stars rating={avg.avg_rating} size={13} activeColor={C.primary} /><Text style={s.avgText}>{Number(avg.avg_rating).toFixed(1)} ({avg.rating_count})</Text></>
              : <Text style={s.noRatingText}>No ratings yet</Text>
            }
          </View>
          <TouchableOpacity
            style={[s.rateBtn, item.user_rating != null && s.rateBtnDone]}
            onPress={() => openRatingModal(item)}
          >
            <Text style={[s.rateBtnText, item.user_rating != null && s.rateBtnTextDone]}>
              {item.user_rating ? `${item.user_rating} stars` : 'Rate it'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSectionHeader = ({ section }: { section: DaySection }) => (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{section.title}</Text>
      <View style={s.sectionBadge}>
        <Text style={s.sectionBadgeText}>{section.totalCaffeine}mg caffeine</Text>
      </View>
    </View>
  );

  const renderDrinkOption = ({ item }: { item: Drink }) => {
    const avg = averages[item.drink_id];
    return (
      <TouchableOpacity
        style={[s.drinkOption, selectedDrink?.drink_id === item.drink_id && s.drinkOptionSelected]}
        onPress={() => setSelectedDrink(item)}
      >
        <Text style={s.drinkOptionName}>{item.name}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={s.drinkOptionMeta}>{item.category} · {item.caffeine_mg}mg</Text>
          {avg && <Text style={s.drinkOptionAvg}>{Number(avg.avg_rating).toFixed(1)} stars</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── MAIN RENDER ─────────────────────────────────────────────────────────

  return (
    <View style={s.container}>

      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Drink Log</Text>
          {totalToday > 0 && <Text style={s.headerSub}>Today: {totalToday}mg caffeine</Text>}
        </View>
        <TouchableOpacity style={s.addButton} onPress={() => setAddModalVisible(true)} activeOpacity={0.8}>
          <Text style={s.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={s.toggleRow}>
        <TouchableOpacity style={[s.toggleBtn, showWeekOnly && s.toggleBtnActive]} onPress={() => setShowWeekOnly(true)}>
          <Text style={[s.toggleBtnText, showWeekOnly && s.toggleBtnTextActive]}>This Week</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.toggleBtn, !showWeekOnly && s.toggleBtnActive]} onPress={() => setShowWeekOnly(false)}>
          <Text style={[s.toggleBtnText, !showWeekOnly && s.toggleBtnTextActive]}>All Time</Text>
        </TouchableOpacity>
      </View>

      {loadingLogs ? (
        <View style={s.emptyState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[s.emptySubtext, { marginTop: 12 }]}>Loading your drinks...</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>{showWeekOnly ? 'No drinks logged this week' : 'No drinks logged yet'}</Text>
          <Text style={s.emptySubtext}>Tap "+ Add" to log your first drink</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item.drink_id}_${item.logged_at}_${index}`}
          renderItem={renderDrinkCard}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={s.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* ── ADD DRINK MODAL ── */}
      <Modal animationType="slide" transparent visible={addModalVisible}
        onRequestClose={() => { setAddModalVisible(false); setSelectedDrink(null); }}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle} numberOfLines={1}>
                {selectedDrink ? selectedDrink.name : 'Select a Drink'}
              </Text>
              <TouchableOpacity onPress={() => { setAddModalVisible(false); setSelectedDrink(null); setSelectedCategory('All'); }}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDrink ? (
              <ScrollView style={{ padding: 20 }}>
                {([
                  ['Category',    selectedDrink.category],
                  ['Type',        selectedDrink.type],
                  ['Base',        selectedDrink.base],
                  ['Caffeine',    `${selectedDrink.caffeine_mg}mg`],
                  ['Dairy-free',  selectedDrink.dairy_free  ? 'Yes' : 'No'],
                  ['Vegan',       selectedDrink.vegan       ? 'Yes' : 'No'],
                  ['Gluten-free', selectedDrink.gluten_free ? 'Yes' : 'No'],
                ] as [string,string][]).map(([label, value]) => (
                  <View key={label} style={s.detailRow}>
                    <Text style={s.detailLabel}>{label}</Text>
                    <Text style={s.detailValue}>{value}</Text>
                  </View>
                ))}
                {averages[selectedDrink.drink_id] && (
                  <View style={[s.detailRow, { alignItems: 'center' }]}>
                    <Text style={s.detailLabel}>Average rating</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Stars rating={averages[selectedDrink.drink_id].avg_rating} size={15} activeColor={C.primary} />
                      <Text style={s.detailValue}>{Number(averages[selectedDrink.drink_id].avg_rating).toFixed(1)}</Text>
                    </View>
                  </View>
                )}
                <TouchableOpacity style={s.backBtn} onPress={() => setSelectedDrink(null)}>
                  <Text style={s.backBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.confirmBtn} onPress={() => handleDrinkSelected(selectedDrink)} activeOpacity={0.8}>
                  <Text style={s.confirmBtnText}>Add to Log</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : loadingDrinks ? (
              <View style={s.centred}><ActivityIndicator size="large" color={C.primary} /><Text style={s.loadingText}>Loading drinks...</Text></View>
            ) : drinksError ? (
              <View style={s.centred}>
                <Text style={s.errorText}>{drinksError}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={fetchDrinks}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={filteredDrinks}
                renderItem={renderDrinkOption}
                keyExtractor={(item) => item.drink_id.toString()}
                contentContainerStyle={{ paddingBottom: 20 }}
                stickyHeaderIndices={[0]}
                ListHeaderComponent={
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    style={s.chipScroll} contentContainerStyle={s.chipScrollContent}>
                    {categories.map((cat) => (
                      <TouchableOpacity key={cat} style={[s.chip, selectedCategory === cat && s.chipActive]}
                        onPress={() => setSelectedCategory(cat)}>
                        <Text style={[s.chipText, selectedCategory === cat && s.chipTextActive]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ── CONTEXT MODAL ── */}
      <Modal animationType="slide" transparent visible={contextModalVisible}
        onRequestClose={() => setContextModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { maxHeight: '75%' }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Before you log…</Text>
              <TouchableOpacity onPress={() => { setContextModalVisible(false); handleConfirmLog(); }}>
                <Text style={[s.backBtnText, { fontSize: 14 }]}>Skip</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <Text style={s.ctxSectionLabel}>How are you feeling?</Text>
              <ContextPillRow options={MOOD_OPTIONS} selected={pendingMood} onSelect={setPendingMood} s={s} />
              <Text style={[s.ctxSectionLabel, { marginTop: 16 }]}>Time of day</Text>
              <ContextPillRow options={TIME_OPTIONS} selected={pendingTime} onSelect={setPendingTime} s={s} />
              <Text style={[s.ctxSectionLabel, { marginTop: 16 }]}>Weather</Text>
              <ContextPillRow options={WEATHER_OPTIONS} selected={pendingWeather} onSelect={setPendingWeather} s={s} />
              <Text style={s.ctxHint}>
                This helps improve recommendations for you and the community. All fields are optional.
              </Text>
              <TouchableOpacity style={[s.confirmBtn, { marginTop: 8 }]} onPress={handleConfirmLog} activeOpacity={0.8}>
                <Text style={s.confirmBtnText}>Log {drinkToLog?.name}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── RATING MODAL ── */}
      <Modal animationType="fade" transparent visible={ratingModalVisible}
        onRequestClose={() => setRatingModalVisible(false)}>
        <View style={s.ratingOverlay}>
          <View style={s.ratingBox}>
            <Text style={s.ratingTitle}>Rate your drink</Text>
            <Text style={s.ratingDrinkName}>{drinkToRate?.name}</Text>
            <Stars rating={pendingRating} size={40} interactive onRate={setPendingRating} activeColor={C.primary} />
            {pendingRating > 0 && (
              <Text style={s.ratingLabel}>
                {['','Poor','Fair','Good','Great','Excellent'][pendingRating]}
              </Text>
            )}
            {(drinkToRate?.mood || drinkToRate?.time_of_day || drinkToRate?.weather) && (
              <View style={s.ratingCtxRow}>
                <Text style={s.ratingCtxLabel}>Saving with context: </Text>
                {drinkToRate.mood        && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{drinkToRate.mood.split(' ')[0]}</Text></View>}
                {drinkToRate.time_of_day && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{drinkToRate.time_of_day}</Text></View>}
                {drinkToRate.weather     && <View style={s.ctxBadge}><Text style={s.ctxBadgeText}>{drinkToRate.weather}</Text></View>}
              </View>
            )}
            <View style={s.ratingBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setRatingModalVisible(false)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, { flex: 1 }]} onPress={handleConfirmRating} disabled={savingRating} activeOpacity={0.8}>
                {savingRating ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmBtnText}>Save Rating</Text>}
              </TouchableOpacity>
            </View>
            <Text style={s.ratingOptional}>Rating is optional</Text>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header:        { backgroundColor: C.surface, paddingTop: 60, paddingBottom: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:   { fontSize: 22, fontWeight: '700', color: C.text },
  headerSub:     { fontSize: 13, color: C.textMuted, marginTop: 2 },
  addButton:     { backgroundColor: C.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  toggleRow:           { flexDirection: 'row', margin: 16, backgroundColor: C.border, borderRadius: 10, padding: 3 },
  toggleBtn:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleBtnActive:     { backgroundColor: C.surface, shadowColor: C.cardShadow, shadowOpacity: 1, shadowRadius: 4, elevation: 2 },
  toggleBtnText:       { fontSize: 13, color: C.textMuted, fontWeight: '500' },
  toggleBtnTextActive: { color: C.text, fontWeight: '700' },

  sectionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  sectionTitle:     { fontSize: 14, fontWeight: '700', color: C.textSecondary },
  sectionBadge:     { backgroundColor: C.primaryMuted, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  sectionBadgeText: { fontSize: 12, color: C.primary, fontWeight: '600' },

  drinkCard:   { backgroundColor: C.surface, borderRadius: 12, marginHorizontal: 16, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: C.border, shadowColor: C.cardShadow, shadowOpacity: 1, shadowRadius: 4, elevation: 2 },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  cardName:    { fontSize: 15, fontWeight: '700', color: C.text },
  cardMeta:    { fontSize: 12, color: C.textMuted, marginTop: 2 },
  cardRight:   { alignItems: 'flex-end', gap: 4 },
  cardTime:    { fontSize: 12, color: C.textMuted },
  deleteBtn:   { fontSize: 14, color: C.textMuted, paddingHorizontal: 2 },
  cardBottom:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.borderSubtle, paddingTop: 10 },
  avgText:     { fontSize: 12, color: C.textMuted },
  noRatingText:{ fontSize: 12, color: C.border },
  rateBtn:         { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: C.primary },
  rateBtnDone:     { backgroundColor: C.primary },
  rateBtnText:     { fontSize: 12, color: C.primary, fontWeight: '600' },
  rateBtnTextDone: { color: '#fff' },

  recTag:     { alignSelf: 'flex-start', backgroundColor: C.primaryMuted, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 5, borderWidth: 1, borderColor: C.border },
  recTagText: { fontSize: 11, color: C.primary, fontWeight: '700' },

  cardContextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  ctxBadge:       { backgroundColor: C.background, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: C.border },
  ctxBadgeText:   { fontSize: 10, color: C.textSecondary, fontWeight: '500' },

  listContent: { paddingBottom: 30 },
  emptyState:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle:  { fontSize: 16, fontWeight: '600', color: C.textSecondary, marginBottom: 6 },
  emptySubtext:{ fontSize: 14, color: C.textMuted, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 20, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle:   { fontSize: 17, fontWeight: '700', color: C.text, flex: 1, marginRight: 12 },
  modalClose:   { fontSize: 20, color: C.textMuted },

  chipScroll:        { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: C.border },
  chipScrollContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:              { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.background, borderWidth: 1, borderColor: C.border },
  chipActive:        { backgroundColor: C.primary, borderColor: C.primary },
  chipText:          { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  chipTextActive:    { color: '#fff' },

  drinkOption:         { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  drinkOptionSelected: { backgroundColor: C.primaryMuted },
  drinkOptionName:     { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 3 },
  drinkOptionMeta:     { fontSize: 13, color: C.textMuted },
  drinkOptionAvg:      { fontSize: 13, color: C.primary, fontWeight: '500' },

  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  detailLabel: { fontSize: 14, color: C.textMuted },
  detailValue: { fontSize: 14, color: C.text, fontWeight: '600' },
  backBtn:     { marginTop: 8, paddingVertical: 8 },
  backBtnText: { color: C.primary, fontSize: 14, fontWeight: '500' },
  confirmBtn:  { backgroundColor: C.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  centred:     { padding: 40, alignItems: 'center' },
  loadingText: { marginTop: 12, color: C.textMuted, fontSize: 14 },
  errorText:   { color: '#8b3a3a', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn:    { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryText:   { color: '#fff', fontWeight: '600' },

  ctxSectionLabel: { fontSize: 13, fontWeight: '700', color: C.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  pillRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  pill:            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background },
  pillSelected:    { borderColor: C.primary, backgroundColor: C.primaryMuted },
  pillText:        { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  pillTextSelected:{ color: C.primary, fontWeight: '700' },
  ctxHint:         { fontSize: 12, color: C.textMuted, textAlign: 'center', marginVertical: 16, lineHeight: 18 },

  ratingOverlay:   { flex: 1, backgroundColor: C.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 },
  ratingBox:       { backgroundColor: C.surface, borderRadius: 20, padding: 28, width: '100%', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.border },
  ratingTitle:     { fontSize: 18, fontWeight: '700', color: C.text },
  ratingDrinkName: { fontSize: 14, color: C.textMuted, marginBottom: 8 },
  ratingLabel:     { fontSize: 15, fontWeight: '600', color: C.primary },
  ratingCtxRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: -4 },
  ratingCtxLabel:  { fontSize: 11, color: C.textMuted },
  ratingBtns:      { flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 },
  cancelBtn:       { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelBtnText:   { color: C.textSecondary, fontWeight: '600' },
  ratingOptional:  { fontSize: 12, color: C.textMuted, marginTop: 4 },
});