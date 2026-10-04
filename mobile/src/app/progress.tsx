import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { newState, stage, type Stage } from '../engine/srs';
import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';
import { Card, Label } from '../ui/kit';

const STAGES: { key: Stage; label: string; emoji: string }[] = [
  { key: 'acquired', label: 'Acquis', emoji: '🏆' },
  { key: 'lapsed', label: 'À revoir', emoji: '🔁' },
  { key: 'retrieved', label: 'Retrouvés (mot → signe)', emoji: '🤲' },
  { key: 'recognized', label: 'Reconnus (signe → mot)', emoji: '👀' },
  { key: 'discovered', label: 'Découverts', emoji: '✨' },
  { key: 'new', label: 'À découvrir', emoji: '📦' },
];

export default function Progress() {
  const c = useColors();
  const { snapshot, stats } = useApp();
  const groups = new Map<Stage, string[]>();
  for (const i of snapshot.items) {
    if (!i.themes.some((m) => m.role === 'active')) continue;
    const st = stage(snapshot.states.get(i.meaningId) ?? newState(i.meaningId));
    groups.set(st, [...(groups.get(st) ?? []), i.word]);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.summary}>
        <Summary value={groups.get('acquired')?.length ?? 0} label="mots acquis" />
        <Summary value={stats.streak} label="jours de suite" />
        <Summary value={stats.xp} label="XP" />
      </Card>
      {STAGES.map(({ key, label, emoji }) => {
        const words = (groups.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'fr'));
        if (!words.length) return null;
        return (
          <View key={key} style={styles.group}>
            <Label>
              {emoji} {label} · {words.length}
            </Label>
            <View style={styles.words}>
              {words.map((w, k) => (
                <Text key={`${w}-${k}`} style={[styles.word, { color: c.ink, backgroundColor: c.card, borderColor: c.line }]}>
                  {w}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 30, fontWeight: '900', color: c.ink }}>{value}</Text>
      <Text style={{ color: c.muted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 18, paddingBottom: 48 },
  summary: { flexDirection: 'row', justifyContent: 'space-around' },
  group: { gap: 8 },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  word: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden', fontSize: 15 },
});
