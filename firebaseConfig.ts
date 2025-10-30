// firebaseConfig.ts
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

// --- CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyCnFrA746eqOSEibgwiKkzubjC4vaTbPEE",
  authDomain: "aroma-15be8.firebaseapp.com",
  projectId: "aroma-15be8",
  storageBucket: "aroma-15be8.appspot.com",
  messagingSenderId: "790836001021",
  appId: "1:790836001021:android:c07492ce5cffb555b4e694",
};

// --- Initialize the app (singleton) ---
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0]!;

// --- Auth ---
const auth: Auth = getAuth(app);

// --- Firestore ---
const db = getFirestore(app);

export { app, auth, db };
