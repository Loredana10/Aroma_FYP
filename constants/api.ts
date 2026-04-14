// constants/api.ts
// This file contains functions for calling our backend API, as well as any related constants like the base URL.
export const API_BASE_URL = 'https://aromafyp-production.up.railway.app';

// Syncs a user's basic info to the database after they sign in with Firebase Auth. This ensures we have a record of them in our users table, which is needed for other API routes to work properly.
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
