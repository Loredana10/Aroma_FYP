import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/auth_context';
import drinksData from '../../assets/data/drinks_catalogue.json';

// Define Drink type based on JSON structure
interface Drink {
  drink_id: number;
  name: string;
  category: string;
  type: string;
  base: string;
  caffeine_mg: number;
  shots: number;
  has_milk: boolean;
  vegan: boolean;
  gluten_free: boolean;
}

// Includes timestamp
interface LoggedDrink extends Drink {
  logged_at: string;
}

export default function LogScreen() {
  const { user } = useAuth();
  const [loggedDrinks, setLoggedDrinks] = useState<LoggedDrink[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);

  // Load logged drinks from AsyncStorage when component mounts
  useEffect(() => {
    loadLoggedDrinks();
  }, [user]);

  // Load drinks from AsyncStorage for current user
  const loadLoggedDrinks = async () => {
    if (!user) return;
    
    try {
      const key = `logged_drinks_${user.uid}`;
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        setLoggedDrinks(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading logged drinks:', error);
    }
  };

  // Save drinks to AsyncStorage
  const saveLoggedDrinks = async (drinks: LoggedDrink[]) => {
    if (!user) return;

    try {
      const key = `logged_drinks_${user.uid}`;
      await AsyncStorage.setItem(key, JSON.stringify(drinks));
    } catch (error) {
      console.error('Error saving logged drinks:', error);
    }
  };

  // Handle adding a drink to the log
  const handleAddDrink = (drink: Drink) => {
    const loggedDrink: LoggedDrink = {
      ...drink,
      logged_at: new Date().toISOString(),
    };

    const updatedLogs = [loggedDrink, ...loggedDrinks];
    setLoggedDrinks(updatedLogs);
    saveLoggedDrinks(updatedLogs);
    setModalVisible(false);
    setSelectedDrink(null);
  };

  // Handle deleting a drink from the log
  const handleDeleteDrink = (index: number) => {
    Alert.alert(
      'Delete Drink',
      'Are you sure you want to remove this drink from your log?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updatedLogs = loggedDrinks.filter((_, i) => i !== index);
            setLoggedDrinks(updatedLogs);
            saveLoggedDrinks(updatedLogs);
          },
        },
      ]
    );
  };

  // Format date for display
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Render a single logged drink item
  const renderLoggedDrink = ({ item, index }: { item: LoggedDrink; index: number }) => (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <Text style={styles.drinkName}>{item.name}</Text>
        <TouchableOpacity onPress={() => handleDeleteDrink(index)}>
          <Text style={styles.deleteButton}>✕</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.timestamp}>{formatDate(item.logged_at)}</Text>
      
      <View style={styles.attributesContainer}>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Category:</Text>
          <Text style={styles.attributeValue}>{item.category}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Type:</Text>
          <Text style={styles.attributeValue}>{item.type}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Base:</Text>
          <Text style={styles.attributeValue}>{item.base}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Caffeine:</Text>
          <Text style={styles.attributeValue}>{item.caffeine_mg}mg</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Shots:</Text>
          <Text style={styles.attributeValue}>{item.shots}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Has Milk:</Text>
          <Text style={styles.attributeValue}>{item.has_milk ? 'Yes' : 'No'}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Vegan:</Text>
          <Text style={styles.attributeValue}>{item.vegan ? 'Yes' : 'No'}</Text>
        </View>
        <View style={styles.attributeRow}>
          <Text style={styles.attributeLabel}>Gluten Free:</Text>
          <Text style={styles.attributeValue}>{item.gluten_free ? 'Yes' : 'No'}</Text>
        </View>
      </View>
    </View>
  );

  // Render drink selection in modal
  const renderDrinkOption = ({ item }: { item: Drink }) => (
    <TouchableOpacity
      style={styles.drinkOption}
      onPress={() => setSelectedDrink(item)}
    >
      <Text style={styles.drinkOptionName}>{item.name}</Text>
      <Text style={styles.drinkOptionCategory}>{item.category}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Drink Log ☕</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.addButtonText}>+ Add Drink</Text>
        </TouchableOpacity>
      </View>

      {/* Logged Drinks List */}
      {loggedDrinks.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No drinks logged yet!</Text>
          <Text style={styles.emptyStateSubtext}>
            Tap the "+ Add Drink" button to start logging your drinks.
          </Text>
        </View>
      ) : (
        <FlatList
          data={loggedDrinks}
          renderItem={renderLoggedDrink}
          keyExtractor={(item, index) => `${item.drink_id}_${index}`}
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* Modal for selecting a drink */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => {
          setModalVisible(false);
          setSelectedDrink(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDrink ? 'Drink Details' : 'Select a Drink'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setModalVisible(false);
                  setSelectedDrink(null);
                }}
              >
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDrink ? (
              // Show selected drink details
              <ScrollView style={styles.drinkDetailsContainer}>
                <Text style={styles.selectedDrinkName}>{selectedDrink.name}</Text>
                
                <View style={styles.detailsGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Category</Text>
                    <Text style={styles.detailValue}>{selectedDrink.category}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Type</Text>
                    <Text style={styles.detailValue}>{selectedDrink.type}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Base</Text>
                    <Text style={styles.detailValue}>{selectedDrink.base}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Caffeine</Text>
                    <Text style={styles.detailValue}>{selectedDrink.caffeine_mg}mg</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Shots</Text>
                    <Text style={styles.detailValue}>{selectedDrink.shots}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Has Milk</Text>
                    <Text style={styles.detailValue}>
                      {selectedDrink.has_milk ? 'Yes' : 'No'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Vegan</Text>
                    <Text style={styles.detailValue}>
                      {selectedDrink.vegan ? 'Yes' : 'No'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Gluten Free</Text>
                    <Text style={styles.detailValue}>
                      {selectedDrink.gluten_free ? 'Yes' : 'No'}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={() => handleAddDrink(selectedDrink)}
                >
                  <Text style={styles.confirmButtonText}>Add to Log</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              // Show drink selection list
              <FlatList
                data={drinksData.drinks}
                renderItem={renderDrinkOption}
                keyExtractor={(item) => item.drink_id.toString()}
                contentContainerStyle={{ paddingBottom: 20 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#7c4dff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  listContainer: {
    padding: 16,
  },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  drinkName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  deleteButton: {
    fontSize: 24,
    color: '#ff5252',
    fontWeight: '600',
    paddingHorizontal: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  attributesContainer: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 12,
  },
  attributeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  attributeLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  attributeValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  modalClose: {
    fontSize: 28,
    color: '#666',
    fontWeight: '300',
  },
  drinkOption: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  drinkOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  drinkOptionCategory: {
    fontSize: 14,
    color: '#999',
  },
  drinkDetailsContainer: {
    padding: 20,
    maxHeight: '100%',
  },
  selectedDrinkName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  detailsGrid: {
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#7c4dff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});