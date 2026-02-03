// firebaseConfig.ts
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

// --- CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyCnFrA746eqOSEibgwiKkzubjC4vaTbPEE",
  authDomain: "aroma-15be8.firebaseapp.com",
  projectId: "aroma-15be8",
  storageBucket: "aroma-15be8.appspot.com",
  messagingSenderId: "790836001021",
  appId: Platform.select({
    ios: "1:790836001021:ios:64124773b9ac89d9b4e694",
    android: "1:790836001021:android:c07492ce5cffb555b4e694",
    default: "1:790836001021:android:c07492ce5cffb555b4e694",
  }),
};

// --- Initialize the app (singleton) ---
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0]!;

// --- Auth ---
const auth: Auth = getAuth(app);

// --- Firestore ---
const db = getFirestore(app);

export { app, auth, db };

