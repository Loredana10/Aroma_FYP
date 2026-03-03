/**
 * Aroma — Design Tokens
 * Warm brown palette, minimal, refined.
 * All colours, typography and spacing live here.
 */

export const palette = {
  // Browns — primary brand palette
  brown50:  '#fdf8f4',
  brown100: '#f5ebe0',
  brown200: '#e8d5c0',
  brown300: '#d4b896',
  brown400: '#c09a70',
  brown500: '#a67c52',   // primary action
  brown600: '#8b6340',
  brown700: '#6f4e2e',
  brown800: '#4a3320',
  brown900: '#2d1f12',

  // Neutrals
  white:    '#ffffff',
  gray50:   '#fafafa',
  gray100:  '#f4f4f4',
  gray200:  '#e8e8e8',
  gray300:  '#d0d0d0',
  gray400:  '#a8a8a8',
  gray500:  '#737373',
  gray600:  '#525252',
  gray700:  '#3d3d3d',
  gray800:  '#262626',
  gray900:  '#171717',
  black:    '#0a0a0a',

  // Semantic
  success:  '#4a7c59',
  warning:  '#b07d2e',
  error:    '#8b3a3a',
};

export const Colors = {
  light: {
    background:       palette.brown50,
    surface:          palette.white,
    surfaceElevated:  palette.white,
    border:           palette.brown200,
    borderSubtle:     palette.brown100,

    text:             palette.brown900,
    textSecondary:    palette.brown700,
    textMuted:        palette.gray500,
    textInverse:      palette.white,

    primary:          palette.brown500,
    primaryHover:     palette.brown600,
    primaryMuted:     palette.brown100,

    tabBar:           palette.white,
    tabBarBorder:     palette.brown200,
    tint:             palette.brown500,

    cardShadow:       'rgba(74, 51, 32, 0.08)',
    overlay:          'rgba(45, 31, 18, 0.5)',
  },
  dark: {
    background:       palette.brown900,
    surface:          palette.brown800,
    surfaceElevated:  '#3a2818',
    border:           palette.brown700,
    borderSubtle:     '#3a2818',

    text:             palette.brown50,
    textSecondary:    palette.brown200,
    textMuted:        palette.brown400,
    textInverse:      palette.brown900,

    primary:          palette.brown400,
    primaryHover:     palette.brown300,
    primaryMuted:     '#3a2818',

    tabBar:           palette.brown900,
    tabBarBorder:     palette.brown800,
    tint:             palette.brown400,

    cardShadow:       'rgba(0, 0, 0, 0.3)',
    overlay:          'rgba(0, 0, 0, 0.6)',
  },
};

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof Colors.light;