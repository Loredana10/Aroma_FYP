export interface Drink {
  id: string;
  name: string;
  type: string;
  description: string;
  caffeine: 'high' | 'medium' | 'low' | 'none';
  temperature: 'hot' | 'cold' | 'both';
  sweetness: 'sweet' | 'neutral' | 'bitter';
  dairyFree: boolean;
  vegan: boolean;
  glutenFree: boolean;
  //image: any; // For require() images
}

export const MOCK_DRINKS: Drink[] = [
  {
    id: '1',
    name: 'Espresso',
    type: 'Coffee',
    description: 'Strong, concentrated coffee shot',
    caffeine: 'high',
    temperature: 'hot',
    sweetness: 'bitter',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/espresso.png'), // You can use placeholder or emoji
  },
  {
    id: '2',
    name: 'Double Espresso',
    type: 'Coffee',
    description: 'Extra strong double shot',
    caffeine: 'high',
    temperature: 'hot',
    sweetness: 'bitter',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/espresso.png'),
  },
  {
    id: '3',
    name: 'Cappuccino',
    type: 'Coffee',
    description: 'Espresso with steamed milk and foam',
    caffeine: 'medium',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/cappuccino.png'),
  },
  {
    id: '4',
    name: 'Latte',
    type: 'Coffee',
    description: 'Smooth espresso with steamed milk',
    caffeine: 'medium',
    temperature: 'both',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/latte.png'),
  },
  {
    id: '5',
    name: 'Flat White',
    type: 'Coffee',
    description: 'Velvety microfoam with espresso',
    caffeine: 'medium',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/flatwhite.png'),
  },
  {
    id: '6',
    name: 'Americano',
    type: 'Coffee',
    description: 'Espresso diluted with hot water',
    caffeine: 'high',
    temperature: 'hot',
    sweetness: 'bitter',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/americano.png'),
  },
  {
    id: '7',
    name: 'Iced Latte',
    type: 'Coffee',
    description: 'Cold espresso with milk over ice',
    caffeine: 'medium',
    temperature: 'cold',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/icedlatte.png'),
  },
  {
    id: '8',
    name: 'Cold Brew',
    type: 'Coffee',
    description: 'Smooth, cold-steeped coffee',
    caffeine: 'high',
    temperature: 'cold',
    sweetness: 'neutral',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/coldbrew.png'),
  },
  {
    id: '9',
    name: 'Mocha',
    type: 'Coffee',
    description: 'Chocolate and espresso with steamed milk',
    caffeine: 'medium',
    temperature: 'hot',
    sweetness: 'sweet',
    dairyFree: false,
    vegan: false,
    glutenFree: false
    //image: require('@/assets/images/mocha.png'),
  },
  {
    id: '10',
    name: 'Oat Milk Latte',
    type: 'Coffee',
    description: 'Creamy oat milk with espresso',
    caffeine: 'medium',
    temperature: 'both',
    sweetness: 'neutral',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/oatlatte.png'),
  },
  {
    id: '11',
    name: 'Matcha Latte',
    type: 'Tea',
    description: 'Japanese green tea with steamed milk',
    caffeine: 'low',
    temperature: 'both',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/matcha.png'),
  },
  {
    id: '12',
    name: 'Chai Latte',
    type: 'Tea',
    description: 'Spiced tea with steamed milk',
    caffeine: 'low',
    temperature: 'hot',
    sweetness: 'sweet',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/chai.png'),
  },
  {
    id: '13',
    name: 'Chamomile Tea',
    type: 'Tea',
    description: 'Calming herbal infusion',
    caffeine: 'none',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/chamomile.png'),
  },
  {
    id: '14',
    name: 'Peppermint Tea',
    type: 'Tea',
    description: 'Refreshing mint herbal tea',
    caffeine: 'none',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/peppermint.png'),
  },
  {
    id: '15',
    name: 'Hot Chocolate',
    type: 'Chocolate',
    description: 'Rich chocolate with steamed milk',
    caffeine: 'low',
    temperature: 'hot',
    sweetness: 'sweet',
    dairyFree: false,
    vegan: false,
    glutenFree: false
    //image: require('@/assets/images/hotchocolate.png'),
  },
  {
    id: '16',
    name: 'Decaf Latte',
    type: 'Coffee',
    description: 'Caffeine-free latte',
    caffeine: 'none',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/decaflatte.png'),
  },
  {
    id: '17',
    name: 'Affogato',
    type: 'Coffee',
    description: 'Espresso poured over vanilla ice cream',
    caffeine: 'high',
    temperature: 'cold',
    sweetness: 'sweet',
    dairyFree: false,
    vegan: false,
    glutenFree: true
    //image: require('@/assets/images/affogato.png'),
  },
  {
    id: '18',
    name: 'Green Tea',
    type: 'Tea',
    description: 'Light and refreshing green tea',
    caffeine: 'low',
    temperature: 'hot',
    sweetness: 'neutral',
    dairyFree: true,
    vegan: true,
    glutenFree: true
    //image: require('@/assets/images/greentea.png'),
  },
];