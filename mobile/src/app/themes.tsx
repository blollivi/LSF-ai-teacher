import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemePicker } from '../components/ThemePicker';
import { themeProgress } from '../engine/feed';
import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';
import { Button, Card, Label, ProgressBar } from '../ui/kit';

const STATUS: Record<string, string> = {
  generating: 'L’IA choisit les mots…',
  validating: 'Vérification des mots et vidéos…',
  ready: 'Prêt',
  failed: 'Échec',
};

export default function Themes() {
  const c = useColors();
  const { snapshot, togglePause, extendTheme } = useApp();
  const [busy, setBusy] = useState<number | null>(null);

  const extend = async (id: number) => {
    setBusy(id);
    try {
      await extendTheme(id, 10);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Label>Nouveau thème</Label>
      <ThemePicker />
      <Label>Mes thèmes</Label>
      {snapshot.themes.length === 0 ? <Text style={{ color: c.muted }}>Aucun thème pour l’instant.</Text> : null}
      {[...snapshot.themes].reverse().map((t) => {
        const p = themeProgress(snapshot, t);
        return (
          <Card key={t.id} style={[styles.theme, t.paused && { opacity: 0.6 }]}>
            <View style={styles.row}>
              <Text style={[styles.name, { color: c.ink }]}>
                {t.emoji} {t.name}
              </Text>
              <Pressable onPress={() => togglePause(t.id)} hitSlop={8}>
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t.paused ? 'Reprendre' : 'Pause'}</Text>
              </Pressable>
            </View>
            <ProgressBar value={p.ratio} />
            <Text style={{ color: c.muted }}>
              {p.acquired} / {p.total} acquis · {STATUS[t.status] ?? t.status}
              {t.status !== 'ready' && t.status !== 'failed' ? ` (${t.activeCount}/${t.targetActive})` : ''}
              {t.paused ? ' · en pause' : ''}
            </Text>
            {t.status === 'ready' && !t.paused ? (
              <Button label="➕ 10 mots" variant="secondary" onPress={() => extend(t.id)} loading={busy === t.id} />
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  theme: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '800', flexShrink: 1 },
});
