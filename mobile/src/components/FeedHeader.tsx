import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';

const RATES = [0.5, 0.75, 1];

export function FeedHeader() {
  const c = useColors();
  const { acquired, stats, session, rate, setRate, downloading, syncError } = useApp();
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 0.75;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Link href="/progress" asChild>
          <Pressable style={StyleSheet.flatten([styles.counter, { backgroundColor: c.accentSoft }])} accessibilityLabel="Progression">
            <Text style={[styles.counterValue, { color: c.ink }]}>{acquired}</Text>
            <Text style={[styles.counterLabel, { color: c.ink }]}>mots{'\n'}acquis</Text>
          </Pressable>
        </Link>
        <View style={styles.badges}>
          <Text style={[styles.badge, { color: c.ink }]}>🔥 {stats.streak}</Text>
          <Text style={[styles.badge, { color: c.ink }]}>⚡ {stats.xp}</Text>
          {session.combo >= 2 ? <Text style={[styles.badge, { color: c.gold }]}>×{session.combo}</Text> : null}
        </View>
        <View style={styles.nav}>
          <Pressable onPress={() => setRate(nextRate)} style={[styles.chip, { borderColor: c.line }]} accessibilityLabel="Vitesse des vidéos">
            <Text style={[styles.chipText, { color: c.ink }]}>{rate === 1 ? '1×' : rate === 0.75 ? '¾×' : '½×'}</Text>
          </Pressable>
          <Link href="/themes" asChild>
            <Pressable style={StyleSheet.flatten([styles.chip, { borderColor: c.line }])} accessibilityLabel="Thèmes">
              <Text style={styles.chipText}>🗂️</Text>
            </Pressable>
          </Link>
          <Link href="/settings" asChild>
            <Pressable style={StyleSheet.flatten([styles.chip, { borderColor: c.line }])} accessibilityLabel="Réglages">
              <Text style={styles.chipText}>⚙️</Text>
            </Pressable>
          </Link>
        </View>
      </View>
      {downloading > 0 ? (
        <Text style={[styles.status, { color: c.muted }]}>⬇︎ {downloading} vidéo{downloading > 1 ? 's' : ''} en téléchargement…</Text>
      ) : syncError ? (
        <Text style={[styles.status, { color: c.bad }]} numberOfLines={1}>
          Hors ligne : {syncError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  counterValue: { fontSize: 26, fontWeight: '900' },
  counterLabel: { fontSize: 11, fontWeight: '700', lineHeight: 13 },
  badges: { flex: 1, flexDirection: 'row', gap: 10 },
  badge: { fontSize: 16, fontWeight: '800' },
  nav: { flexDirection: 'row', gap: 6 },
  chip: { minWidth: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 16, fontWeight: '800' },
  status: { fontSize: 13 },
});
