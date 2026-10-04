import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '../db/schema';
import { AppProvider } from '../state/AppContext';
import { useColors } from '../ui/colors';

export default function RootLayout() {
  const c = useColors();
  return (
    <SQLiteProvider databaseName="lsf.db" onInit={migrate}>
      <AppProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.ink,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.bg },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="themes" options={{ title: 'Thèmes' }} />
          <Stack.Screen name="progress" options={{ title: 'Progression' }} />
          <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
        </Stack>
      </AppProvider>
    </SQLiteProvider>
  );
}
