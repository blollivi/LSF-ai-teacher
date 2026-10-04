import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F3EC',
  card: '#FFFFFF',
  ink: '#1D1B26',
  muted: '#6E6A78',
  line: '#E6E0D6',
  accent: '#FF6B4A',
  accentInk: '#FFFFFF',
  accentSoft: '#FFE3DB',
  good: '#1F9D63',
  goodSoft: '#D9F3E6',
  bad: '#D93F45',
  badSoft: '#FBE0E1',
  gold: '#E8A317',
  video: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#14131A',
  card: '#1F1D27',
  ink: '#F4F1EA',
  muted: '#A19DAB',
  line: '#33303D',
  accent: '#FF7E62',
  accentInk: '#1D1B26',
  accentSoft: '#3D2620',
  good: '#3CC487',
  goodSoft: '#173527',
  bad: '#F06469',
  badSoft: '#3B1D20',
  gold: '#F2B93B',
  video: '#FFFFFF',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
