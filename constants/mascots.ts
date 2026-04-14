// constants/mascots.ts
// Mascot definitions for the Aroma app.


export interface Mascot {
  id:           string;
  name:         string;
  placeholder:  string;  // emoji fallback — always required
  image?:       any;  
}

export const MASCOTS: Mascot[] = [
  { id: 'mascot_01', name: 'Coco',  placeholder: '☕', image: require('@/assets/mascots/Cat1.png') },
  { id: 'mascot_02', name: 'Milky',    placeholder: '🧋', image: require('@/assets/mascots/Cat2.png') },
  { id: 'mascot_03', name: 'Espresso',  placeholder: '⚡', image: require('@/assets/mascots/Cat3.png') },
  { id: 'mascot_04', name: 'Matcha',    placeholder: '🍵', image: require('@/assets/mascots/Cat4.png') },
  { id: 'mascot_05', name: 'Mint',      placeholder: '🌿', image: require('@/assets/mascots/Cat5.png') },
  { id: 'mascot_06', name: 'Mocha',     placeholder: '🍫', image: require('@/assets/mascots/Cat6.png') },
  { id: 'mascot_07', name: 'Caramel',  placeholder: '🍪', image: require('@/assets/mascots/Cat7.png') },
  { id: 'mascot_08', name: 'Almond',     placeholder: '🌰', image: require('@/assets/mascots/Cat8.png') },
  { id: 'mascot_09', name: 'Icy',       placeholder: '🧊', image: require('@/assets/mascots/Cat9.png') },
  { id: 'mascot_10', name: 'Vanilla',     placeholder: '🌻', image: require('@/assets/mascots/Cat10.png') },
];

export const getMascotById = (id: string): Mascot | undefined =>
  MASCOTS.find((m) => m.id === id);