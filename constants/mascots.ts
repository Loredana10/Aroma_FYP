// constants/mascots.ts
// ─────────────────────────────────────────────────────────────────────────────
// Mascot definitions for the Aroma app.
//
// HOW TO ADD REAL IMAGES:
//   1. Add your image files to assets/mascots/ (e.g. mascot_01.png)
//   2. Replace the `placeholder` emoji with:
//      image: require('@/assets/mascots/mascot_01.png')
//   3. Remove the `placeholder` field once images are in place.
// ─────────────────────────────────────────────────────────────────────────────

export interface Mascot {
  id:          string;
  name:        string;
  placeholder: string;   // emoji used until real artwork is ready
  // image?: any;         // uncomment when real assets are added
}

export const MASCOTS: Mascot[] = [
  { id: 'mascot_01', name: 'Brewster',  placeholder: '☕' },
  { id: 'mascot_02', name: 'Frothy',    placeholder: '🧋' },
  { id: 'mascot_03', name: 'Espresso',  placeholder: '⚡' },
  { id: 'mascot_04', name: 'Matcha',    placeholder: '🍵' },
  { id: 'mascot_05', name: 'Coco',      placeholder: '🌿' },
  { id: 'mascot_06', name: 'Mocha',     placeholder: '🍫' },
  { id: 'mascot_07', name: 'Biscotti',  placeholder: '🍪' },
  { id: 'mascot_08', name: 'Hazel',     placeholder: '🌰' },
  { id: 'mascot_09', name: 'Icy',       placeholder: '🧊' },
  { id: 'mascot_10', name: 'Sunny',     placeholder: '🌻' },
];

export const getMascotById = (id: string): Mascot | undefined =>
  MASCOTS.find((m) => m.id === id);