// constants/api.ts
// Update this IP address whenever your network changes
// Find your IP by running ipconfig and looking for the WiFi IPv4 address
export const API_BASE_URL = 'http://10.198.27.94:3000';

// Sync a Firebase user to PostgreSQL
// Call this after every sign in and sign up
export const syncUserToDatabase = async (
  uid: string,
  email: string | null,
  displayName: string | null
) => {
  try {
    await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: uid,
        email: email,
        display_name: displayName,
      }),
    });
  } catch (error) {
    // Non-fatal — Firebase auth still works even if this fails
    console.error('Failed to sync user to database:', error);
  }
};
