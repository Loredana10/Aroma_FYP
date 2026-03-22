import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Animated,
  Dimensions, Platform, Linking,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_PEEK = 260;
const SHEET_FULL = SCREEN_HEIGHT * 0.65;

const GOOGLE_PLACES_API_KEY = Platform.select({
  android: 'AIzaSyDJDevRkFdgb0DcIdwlpa4hiyw0P1H4_os',
  ios:     'AIzaSyDsz1TvuJKba2UdMbEgrgNBJW89CcMJI6A',
  default: 'AIzaSyDJDevRkFdgb0DcIdwlpa4hiyw0P1H4_os',
});

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Cafe {
  place_id: string;
  name: string;
  vicinity: string;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: { open_now: boolean };
  geometry: { location: { lat: number; lng: number } };
  price_level?: number;
}

interface CafeDetails extends Omit<Cafe, 'opening_hours'> {
  formatted_phone_number?: string;
  formatted_address?: string;
  website?: string;
  opening_hours?: { open_now: boolean; weekday_text?: string[] };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const stars = (rating: number) => {
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
};

const openMaps = (cafe: Cafe) => {
  const { lat, lng } = cafe.geometry.location;
  const url = Platform.select({
    ios:     `maps:0,0?q=${cafe.name}@${lat},${lng}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(cafe.name)})`,
    default: `https://maps.google.com/?q=${lat},${lng}`,
  });
  if (url) Linking.openURL(url);
};

// ─── MAIN ────────────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const colorScheme = useColorScheme();
  const C = Colors[colorScheme ?? 'light'];
  const s = makeStyles(C);

  const [location,       setLocation]       = useState<Location.LocationObject | null>(null);
  const [region,         setRegion]         = useState<Region | null>(null);
  const [cafes,          setCafes]          = useState<Cafe[]>([]);
  const [selectedCafe,   setSelectedCafe]   = useState<CafeDetails | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [sheetExpanded,  setSheetExpanded]  = useState(false);

  const mapRef      = useRef<MapView>(null);
  const sheetHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => { requestLocation(); }, []);

  // ─── LOCATION ──────────────────────────────────────────────────────────────

  const requestLocation = async () => {
    setLoading(true); setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Please enable it in Settings to see nearby cafes.');
        setLoading(false); return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocation(loc);
      const r: Region = {
        latitude: loc.coords.latitude, longitude: loc.coords.longitude,
        latitudeDelta: 0.01, longitudeDelta: 0.01,
      };
      setRegion(r);
      fetchNearbyCafes(loc.coords.latitude, loc.coords.longitude);
    } catch {
      setError('Could not get your location. Please try again.');
      setLoading(false);
    }
  };

  // ─── PLACES API ────────────────────────────────────────────────────────────

  const fetchNearbyCafes = async (lat: number, lng: number) => {
    try {
      const res  = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=1000&type=cafe&key=${GOOGLE_PLACES_API_KEY}`
      );
      const data = await res.json();
      if (data.status === 'OK')                setCafes(data.results);
      else if (data.status === 'ZERO_RESULTS') setCafes([]);
      else                                     setError(`Places API error: ${data.status}`);
    } catch { setError('Could not load nearby cafes.'); }
    finally  { setLoading(false); }
  };

  const fetchCafeDetails = async (placeId: string) => {
    setLoadingDetails(true);
    try {
      const res  = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,vicinity,formatted_address,rating,user_ratings_total,opening_hours,geometry,formatted_phone_number,website,price_level&key=${GOOGLE_PLACES_API_KEY}`
      );
      const data = await res.json();
      if (data.status === 'OK') return data.result as CafeDetails;
    } catch { console.error('Error fetching cafe details'); }
    finally  { setLoadingDetails(false); }
    return null;
  };

  // ─── INTERACTIONS ──────────────────────────────────────────────────────────

  const handleMarkerPress = async (cafe: Cafe) => {
    mapRef.current?.animateToRegion({
      latitude: cafe.geometry.location.lat, longitude: cafe.geometry.location.lng,
      latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 400);
    setSelectedCafe(cafe as CafeDetails);
    setSheetExpanded(false);
    animateSheet(SHEET_PEEK);
    const details = await fetchCafeDetails(cafe.place_id);
    if (details) setSelectedCafe(details);
  };

  const handleCloseSheet = () => {
    animateSheet(0);
    setTimeout(() => setSelectedCafe(null), 300);
    setSheetExpanded(false);
  };

  const toggleSheetExpand = () => {
    const next = !sheetExpanded;
    setSheetExpanded(next);
    animateSheet(next ? SHEET_FULL : SHEET_PEEK);
  };

  const animateSheet = (toValue: number) => {
    Animated.spring(sheetHeight, { toValue, useNativeDriver: false, tension: 65, friction: 11 }).start();
  };

  // ─── STATES ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centred}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={s.loadingText}>Finding cafes near you...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.centred}>
        <Text style={s.errorTitle}>Location unavailable</Text>
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={requestLocation} activeOpacity={0.8}>
          <Text style={s.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>

      {/* Map */}
      {region && (
        <MapView
          ref={mapRef}
          style={s.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          onPress={() => {
            if (Platform.OS === 'ios') return;
            handleCloseSheet();
          }}
        >
          {cafes.map((cafe) => (
            <Marker
              key={cafe.place_id}
              coordinate={{ latitude: cafe.geometry.location.lat, longitude: cafe.geometry.location.lng }}
              onPress={() => handleMarkerPress(cafe)}
              onSelect={() => handleMarkerPress(cafe)}
              tracksViewChanges={false}
              pinColor="#c0392b"
            />
          ))}
        </MapView>
      )}

      {/* Header overlay */}
      <View style={s.headerOverlay} pointerEvents="none">
        <View style={s.headerCard}>
          <Text style={s.headerTitle}>Nearby Cafes</Text>
          <Text style={s.headerSub}>
            {cafes.length > 0 ? `${cafes.length} found within 1km` : 'No cafes found nearby'}
          </Text>
        </View>
      </View>

      {/* My location button */}
      {location && (
        <TouchableOpacity
          style={s.myLocationBtn}
          onPress={() => mapRef.current?.animateToRegion({
            latitude: location.coords.latitude, longitude: location.coords.longitude,
            latitudeDelta: 0.01, longitudeDelta: 0.01,
          }, 400)}
          activeOpacity={0.8}
        >
          <Text style={s.myLocationIcon}>◎</Text>
        </TouchableOpacity>
      )}

      {/* Bottom sheet */}
      {selectedCafe && (
        <Animated.View style={[s.sheet, { height: sheetHeight }]}>

          {/* Drag handle + close row — rendered ABOVE the ScrollView so nothing blocks it */}
          <View style={s.sheetTopBar}>
            <TouchableOpacity style={s.sheetHandleArea} onPress={toggleSheetExpand} activeOpacity={0.7}>
              <View style={s.handleBar} />
            </TouchableOpacity>
            <TouchableOpacity style={s.closeBtn} onPress={handleCloseSheet} hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <Text style={s.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            scrollEnabled={sheetExpanded}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.sheetContent}
          >
            {/* Name & status */}
            <View style={s.sheetTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.cafeName} numberOfLines={2}>{selectedCafe.name}</Text>
                <Text style={s.cafeAddress} numberOfLines={2}>
                  {selectedCafe.formatted_address || selectedCafe.vicinity}
                </Text>
              </View>
              {selectedCafe.opening_hours && (
                <View style={[s.statusBadge,
                  selectedCafe.opening_hours.open_now ? s.statusOpen : s.statusClosed
                ]}>
                  <Text style={[s.statusText,
                    { color: selectedCafe.opening_hours.open_now ? '#4a7c59' : '#8b3a3a' }
                  ]}>
                    {selectedCafe.opening_hours.open_now ? 'Open' : 'Closed'}
                  </Text>
                </View>
              )}
            </View>

            {/* Rating */}
            {selectedCafe.rating && (
              <View style={s.ratingRow}>
                <Text style={s.ratingStars}>{stars(selectedCafe.rating)}</Text>
                <Text style={s.ratingNum}>{selectedCafe.rating.toFixed(1)}</Text>
                {selectedCafe.user_ratings_total && (
                  <Text style={s.ratingCount}>({selectedCafe.user_ratings_total} reviews)</Text>
                )}
              </View>
            )}

            {loadingDetails && <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 12 }} />}

            {/* Hours — expanded only */}
            {sheetExpanded && selectedCafe.opening_hours?.weekday_text && (
              <View style={s.hoursBox}>
                <Text style={s.hoursTitle}>Opening Hours</Text>
                {selectedCafe.opening_hours.weekday_text.map((line, i) => (
                  <Text key={i} style={s.hoursLine}>{line}</Text>
                ))}
              </View>
            )}

            {/* Actions */}
            <View style={s.actionRow}>
              <TouchableOpacity style={s.actionBtn} onPress={() => openMaps(selectedCafe)} activeOpacity={0.8}>
                <Text style={s.actionBtnLabel}>Directions</Text>
              </TouchableOpacity>
              {selectedCafe.formatted_phone_number && (
                <TouchableOpacity style={s.actionBtn} onPress={() => Linking.openURL(`tel:${selectedCafe.formatted_phone_number}`)} activeOpacity={0.8}>
                  <Text style={s.actionBtnLabel}>Call</Text>
                </TouchableOpacity>
              )}
              {selectedCafe.website && (
                <TouchableOpacity style={s.actionBtn} onPress={() => selectedCafe.website && Linking.openURL(selectedCafe.website)} activeOpacity={0.8}>
                  <Text style={s.actionBtnLabel}>Website</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const makeStyles = (C: typeof Colors.light) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  map:       { flex: 1 },

  centred:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: C.background },
  loadingText:{ marginTop: 14, fontSize: 14, color: C.textMuted },
  errorTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 8 },
  errorText:  { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  retryBtn:   { backgroundColor: C.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24 },
  retryText:  { color: '#fff', fontWeight: '600', fontSize: 14 },

  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 60, paddingHorizontal: 16 },
  headerCard:    { backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 4, borderWidth: 1, borderColor: C.border },
  headerTitle:   { fontSize: 16, fontWeight: '700', color: C.text },
  headerSub:     { fontSize: 12, color: C.textMuted, marginTop: 1 },

  myLocationBtn:  { position: 'absolute', bottom: 280, right: 16, backgroundColor: C.surface, width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', shadowColor: C.cardShadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 4, elevation: 4, borderWidth: 1, borderColor: C.border },
  myLocationIcon: { fontSize: 20, color: C.primary },

  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 12, overflow: 'hidden', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },

  // Top bar sits above ScrollView — close button can never be blocked
  sheetTopBar:    { flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 4, paddingHorizontal: 16 },
  sheetHandleArea:{ flex: 1, alignItems: 'center' },
  handleBar:      { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2 },
  closeBtn:       { padding: 4 },
  closeBtnText:   { fontSize: 18, color: C.textMuted },

  sheetContent: { paddingHorizontal: 20, paddingBottom: 48 },

  sheetTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, marginTop: 4 },
  cafeName:    { fontSize: 17, fontWeight: '700', color: C.text, marginRight: 8, marginBottom: 3 },
  cafeAddress: { fontSize: 13, color: C.textMuted, lineHeight: 18 },

  statusBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusOpen:   { backgroundColor: 'rgba(74,124,89,0.1)' },
  statusClosed: { backgroundColor: 'rgba(139,58,58,0.1)' },
  statusText:   { fontSize: 12, fontWeight: '700' },

  ratingRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  ratingStars: { fontSize: 15, color: C.primary },
  ratingNum:   { fontSize: 14, fontWeight: '700', color: C.text },
  ratingCount: { fontSize: 12, color: C.textMuted },

  hoursBox:   { backgroundColor: C.background, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  hoursTitle: { fontSize: 12, fontWeight: '700', color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  hoursLine:  { fontSize: 13, color: C.textSecondary, lineHeight: 21 },

  actionRow:     { flexDirection: 'row', gap: 8 },
  actionBtn:     { flex: 1, backgroundColor: C.primaryMuted, borderRadius: 10, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  actionBtnLabel:{ fontSize: 13, fontWeight: '600', color: C.primary },
});