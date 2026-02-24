import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  FlatList, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/auth_context';
import { API_BASE_URL } from '@/constants/api';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Drink {
  drink_id: number;
  name: string;
  category: string;
  type: string;
  base: string;
  caffeine_mg: number;
  shots: number;
  dairy_free: boolean;
  vegan: boolean;
  gluten_free: boolean;
  milk_alternative_available: boolean;
}

interface LoggedDrink extends Drink {
  logged_at: string;
  user_rating?: number;      // the current user's rating (1-5), if given
}

interface DrinkAverage {
  drink_id: number;
  avg_rating: number;
  rating_count: number;
}

// ─── STAR COMPONENT ───────────────────────────────────────────────────────────

const Stars = ({
  rating,
  size = 16,
  interactive = false,
  onRate,
}: {
  rating: number;
  size?: number;
  interactive?: boolean;
  onRate?: (r: number) => void;
}) => (
  <View style={{ flexDirection: 'row', gap: 2 }}>
    {[1, 2, 3, 4, 5].map((star) => (
      <TouchableOpacity
        key={star}
        disabled={!interactive}
        onPress={() => onRate?.(star)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: size, color: star <= Math.round(rating) ? '#f5a623' : '#ddd' }}>
          ★
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function LogScreen() {
  const { user } = useAuth();

  const [loggedDrinks, setLoggedDrinks] = useState<LoggedDrink[]>([]);
  const [allDrinks, setAllDrinks] = useState<Drink[]>([]);
  const [filteredDrinks, setFilteredDrinks] = useState<Drink[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [averages, setAverages] = useState<Record<number, DrinkAverage>>({});
  const [userRatings, setUserRatings] = useState<Record<number, number>>({});

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const [loadingDrinks, setLoadingDrinks] = useState(false);
  const [drinksError, setDrinksError] = useState<string | null>(null);

  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [drinkToRate, setDrinkToRate] = useState<LoggedDrink | null>(null);
  const [pendingRating, setPendingRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  // ─── LOAD ON MOUNT ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadLoggedDrinks();
    fetchAverages();
    fetchUserRatings();
  }, [user]);

  useEffect(() => {
    if (addModalVisible && allDrinks.length === 0) fetchDrinks();
  }, [addModalVisible]);

  useEffect(() => {
    setFilteredDrinks(
      selectedCategory === 'All'
        ? allDrinks
        : allDrinks.filter((d) => d.category === selectedCategory)
    );
  }, [selectedCategory, allDrinks]);

  // ─── API CALLS ──────────────────────────────────────────────────────────────

  const fetchDrinks = async () => {
    setLoadingDrinks(true);
    setDrinksError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drinks`);
      if (!res.ok) throw new Error('Server error');
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

  const fetchAverages = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ratings/averages`);
      if (!res.ok) return;
      const data: DrinkAverage[] = await res.json();
      const map: Record<number, DrinkAverage> = {};
      data.forEach((d) => { map[d.drink_id] = d; });
      setAverages(map);
    } catch {
      // Non-fatal — averages just won't show
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
      // Sync existing ratings into any already-loaded logged drinks
      setLoggedDrinks((prev) =>
        prev.map((d) => ({ ...d, user_rating: map[d.drink_id] ?? d.user_rating }))
      );
    } catch {
      // Non-fatal
    }
  };

  const submitRating = async (drinkId: number, rating: number) => {
    if (!user) return;
    setSavingRating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.uid,
          drink_id: drinkId,
          star_rating: rating,
        }),
      });
      if (!res.ok) throw new Error('Failed to save rating');

      // Update the logged drink's user_rating in state and AsyncStorage
      const updated = loggedDrinks.map((d) =>
        d.drink_id === drinkId ? { ...d, user_rating: rating } : d
      );
      setLoggedDrinks(updated);
      saveLoggedDrinks(updated);

      // Refresh averages so the card updates
      fetchAverages();

    } catch {
      Alert.alert('Error', 'Could not save rating. Please try again.');
    } finally {
      setSavingRating(false);
    }
  };

  // ─── ASYNC STORAGE ──────────────────────────────────────────────────────────

  const loadLoggedDrinks = async () => {
    if (!user) return;
    try {
      const stored = await AsyncStorage.getItem(`logged_drinks_${user.uid}`);
      if (stored) setLoggedDrinks(JSON.parse(stored));
    } catch (e) {
      console.error('Error loading logged drinks:', e);
    }
  };

  const saveLoggedDrinks = async (drinks: LoggedDrink[]) => {
    if (!user) return;
    try {
      await AsyncStorage.setItem(`logged_drinks_${user.uid}`, JSON.stringify(drinks));
    } catch (e) {
      console.error('Error saving logged drinks:', e);
    }
  };

  // ─── HANDLERS ───────────────────────────────────────────────────────────────

  const handleAddDrink = (drink: Drink) => {
    const loggedDrink: LoggedDrink = {
      ...drink,
      logged_at: new Date().toISOString(),
      user_rating: userRatings[drink.drink_id],
    };
    const updated = [loggedDrink, ...loggedDrinks];
    setLoggedDrinks(updated);
    saveLoggedDrinks(updated);
    setAddModalVisible(false);
    setSelectedDrink(null);
    setSelectedCategory('All');
  };

  const handleDeleteDrink = (index: number) => {
    Alert.alert('Remove Drink', 'Remove this drink from your log?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          const updated = loggedDrinks.filter((_, i) => i !== index);
          setLoggedDrinks(updated);
          saveLoggedDrinks(updated);
        },
      },
    ]);
  };

  const openRatingModal = (drink: LoggedDrink) => {
    setDrinkToRate(drink);
    setPendingRating(drink.user_rating ?? 0);
    setRatingModalVisible(true);
  };

  const handleConfirmRating = async () => {
    if (!drinkToRate || pendingRating === 0) {
      Alert.alert('Select a rating', 'Please tap a star to give a rating.');
      return;
    }
    await submitRating(drinkToRate.drink_id, pendingRating);
    setRatingModalVisible(false);
    setDrinkToRate(null);
  };

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IE', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const totalCaffeine = loggedDrinks.reduce((s, d) => s + d.caffeine_mg, 0);

  // ─── RENDER: LOGGED DRINK CARD ───────────────────────────────────────────────

  const renderLoggedDrink = ({ item, index }: { item: LoggedDrink; index: number }) => {
    const avg = averages[item.drink_id];

    return (
      <View style={styles.logCard}>
        {/* Top row: name + delete */}
        <View style={styles.logHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.drinkName}>{item.name}</Text>
            <Text style={styles.drinkCategory}>{item.category} · {item.caffeine_mg}mg caffeine</Text>
          </View>
          <TouchableOpacity onPress={() => handleDeleteDrink(index)}>
            <Text style={styles.deleteButton}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.timestamp}>{formatDate(item.logged_at)}</Text>

        {/* Ratings row */}
        <View style={styles.ratingsRow}>
          {/* Average rating */}
          <View style={styles.avgContainer}>
            {avg ? (
              <>
                <Stars rating={avg.avg_rating} size={14} />
                <Text style={styles.avgText}>
                  {Number(avg.avg_rating).toFixed(1)} ({avg.rating_count})
                </Text>
              </>
            ) : (
              <Text style={styles.noRatingText}>No ratings yet</Text>
            )}
          </View>

          {/* User rating button */}
          <TouchableOpacity
            style={[styles.rateButton, item.user_rating ? styles.rateButtonDone : null]}
            onPress={() => openRatingModal(item)}
          >
            <Text style={[styles.rateButtonText, item.user_rating ? styles.rateButtonTextDone : null]}>
              {item.user_rating ? `Your rating: ${item.user_rating}★` : 'Rate it'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── RENDER: DRINK OPTION IN MODAL ──────────────────────────────────────────

  const renderDrinkOption = ({ item }: { item: Drink }) => {
    const avg = averages[item.drink_id];
    return (
      <TouchableOpacity
        style={[styles.drinkOption, selectedDrink?.drink_id === item.drink_id && styles.drinkOptionSelected]}
        onPress={() => setSelectedDrink(item)}
      >
        <Text style={styles.drinkOptionName}>{item.name}</Text>
        <View style={styles.drinkOptionMeta}>
          <Text style={styles.drinkOptionCategory}>{item.category}</Text>
          {avg && (
            <Text style={styles.drinkOptionAvg}>⭐ {Number(avg.avg_rating).toFixed(1)}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Drink Log ☕</Text>
          {loggedDrinks.length > 0 && (
            <Text style={styles.headerSub}>
              {loggedDrinks.length} drinks · {totalCaffeine}mg caffeine
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => setAddModalVisible(true)}>
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Log list */}
      {loggedDrinks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>☕</Text>
          <Text style={styles.emptyStateText}>No drinks logged yet</Text>
          <Text style={styles.emptyStateSubtext}>Tap "+ Add" to log your first drink</Text>
        </View>
      ) : (
        <FlatList
          data={loggedDrinks}
          renderItem={renderLoggedDrink}
          keyExtractor={(item, index) => `${item.drink_id}_${index}`}
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* ── ADD DRINK MODAL ───────────────────────────────────────────── */}
      <Modal
        animationType="slide"
        transparent
        visible={addModalVisible}
        onRequestClose={() => { setAddModalVisible(false); setSelectedDrink(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDrink ? selectedDrink.name : 'Pick a Drink'}
              </Text>
              <TouchableOpacity onPress={() => { setAddModalVisible(false); setSelectedDrink(null); setSelectedCategory('All'); }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDrink ? (
              <ScrollView style={{ padding: 20 }}>
                {[
                  ['Category', selectedDrink.category],
                  ['Type', selectedDrink.type],
                  ['Base', selectedDrink.base],
                  ['Caffeine', `${selectedDrink.caffeine_mg}mg`],
                  ['Dairy-free', selectedDrink.dairy_free ? '✅ Yes' : '❌ No'],
                  ['Vegan', selectedDrink.vegan ? '✅ Yes' : '❌ No'],
                  ['Gluten-free', selectedDrink.gluten_free ? '✅ Yes' : '❌ No'],
                ].map(([label, value]) => (
                  <View key={label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{label}</Text>
                    <Text style={styles.detailValue}>{value}</Text>
                  </View>
                ))}

                {/* Average rating in detail view */}
                {averages[selectedDrink.drink_id] && (
                  <View style={[styles.detailRow, { alignItems: 'center' }]}>
                    <Text style={styles.detailLabel}>Avg rating</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Stars rating={averages[selectedDrink.drink_id].avg_rating} size={16} />
                      <Text style={styles.detailValue}>
                        {Number(averages[selectedDrink.drink_id].avg_rating).toFixed(1)}
                      </Text>
                    </View>
                  </View>
                )}

                <TouchableOpacity style={styles.backButton} onPress={() => setSelectedDrink(null)}>
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={() => handleAddDrink(selectedDrink)}>
                  <Text style={styles.confirmButtonText}>Add to Log</Text>
                </TouchableOpacity>
              </ScrollView>

            ) : loadingDrinks ? (
              <View style={styles.centred}>
                <ActivityIndicator size="large" color="#7c4dff" />
                <Text style={styles.loadingText}>Loading drinks...</Text>
              </View>

            ) : drinksError ? (
              <View style={styles.centred}>
                <Text style={styles.errorText}>{drinksError}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={fetchDrinks}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>

            ) : (
              <>
                {/* Category filter chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  style={styles.categoryScroll} contentContainerStyle={styles.categoryScrollContent}>
                  {categories.map((cat) => (
                    <TouchableOpacity key={cat}
                      style={[styles.chip, selectedCategory === cat && styles.chipActive]}
                      onPress={() => setSelectedCategory(cat)}>
                      <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <FlatList
                  data={filteredDrinks}
                  renderItem={renderDrinkOption}
                  keyExtractor={(item) => item.drink_id.toString()}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── RATING MODAL ──────────────────────────────────────────────── */}
      <Modal
        animationType="fade"
        transparent
        visible={ratingModalVisible}
        onRequestClose={() => setRatingModalVisible(false)}
      >
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingBox}>
            <Text style={styles.ratingTitle}>Rate your drink</Text>
            <Text style={styles.ratingDrinkName}>{drinkToRate?.name}</Text>

            <Stars
              rating={pendingRating}
              size={40}
              interactive
              onRate={(r) => setPendingRating(r)}
            />

            {pendingRating > 0 && (
              <Text style={styles.ratingLabel}>
                {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'][pendingRating]}
              </Text>
            )}

            <View style={styles.ratingButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setRatingModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { flex: 1 }]}
                onPress={handleConfirmRating}
                disabled={savingRating}>
                {savingRating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.confirmButtonText}>Save Rating</Text>
                }
              </TouchableOpacity>
            </View>

            <Text style={styles.ratingOptional}>Rating is optional — you can skip this</Text>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#fff', paddingTop: 60, paddingBottom: 20,
    paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#e0e0e0',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#333' },
  headerSub: { fontSize: 13, color: '#999', marginTop: 2 },
  addButton: {
    backgroundColor: '#7c4dff', paddingVertical: 8,
    paddingHorizontal: 18, borderRadius: 20,
  },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  listContainer: { padding: 16 },

  // Log card
  logCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 3,
  },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  drinkName: { fontSize: 17, fontWeight: '700', color: '#333' },
  drinkCategory: { fontSize: 13, color: '#999', marginTop: 2 },
  deleteButton: { fontSize: 18, color: '#ccc', paddingHorizontal: 4 },
  timestamp: { fontSize: 12, color: '#bbb', marginBottom: 10 },

  // Ratings row on card
  ratingsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 10,
  },
  avgContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avgText: { fontSize: 12, color: '#888', marginLeft: 4 },
  noRatingText: { fontSize: 12, color: '#ccc' },
  rateButton: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1, borderColor: '#7c4dff',
  },
  rateButtonDone: { backgroundColor: '#7c4dff', borderColor: '#7c4dff' },
  rateButtonText: { fontSize: 12, color: '#7c4dff', fontWeight: '600' },
  rateButtonTextDone: { color: '#fff' },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyStateText: { fontSize: 18, fontWeight: '600', color: '#666', marginBottom: 8 },
  emptyStateSubtext: { fontSize: 14, color: '#999', textAlign: 'center' },

  // Modal shared
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff', borderTopLeftRadius: 20,
    borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333', flex: 1, marginRight: 12 },
  modalClose: { fontSize: 22, color: '#999' },

  // Category chips
  categoryScroll: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  categoryScrollContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 6 },
  chipActive: { backgroundColor: '#7c4dff' },
  chipText: { fontSize: 13, color: '#666', fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  // Drink list option
  drinkOption: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  drinkOptionSelected: { backgroundColor: '#f3f0ff' },
  drinkOptionName: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 3 },
  drinkOptionMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  drinkOptionCategory: { fontSize: 13, color: '#999' },
  drinkOptionAvg: { fontSize: 13, color: '#f5a623', fontWeight: '500' },

  // Detail view
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  detailLabel: { fontSize: 15, color: '#888' },
  detailValue: { fontSize: 15, color: '#333', fontWeight: '600' },
  backButton: { marginTop: 8, paddingVertical: 8 },
  backButtonText: { color: '#7c4dff', fontSize: 14, fontWeight: '500' },
  confirmButton: {
    backgroundColor: '#7c4dff', paddingVertical: 14,
    borderRadius: 12, alignItems: 'center', marginBottom: 8,
  },
  confirmButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Loading / error
  centred: { padding: 40, alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#999', fontSize: 14 },
  errorText: { color: '#e53935', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryButton: { backgroundColor: '#7c4dff', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryText: { color: '#fff', fontWeight: '600' },

  // Rating modal
  ratingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  ratingBox: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28,
    width: '100%', alignItems: 'center', gap: 12,
  },
  ratingTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  ratingDrinkName: { fontSize: 15, color: '#666', marginBottom: 8 },
  ratingLabel: { fontSize: 15, fontWeight: '600', color: '#7c4dff' },
  ratingButtons: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 },
  cancelButton: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center',
  },
  cancelButtonText: { color: '#666', fontWeight: '600' },
  ratingOptional: { fontSize: 12, color: '#bbb', marginTop: 4 },
});