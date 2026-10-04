import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ThemeSuggestion } from '../api/client';
import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';
import { Button } from '../ui/kit';

const STARTERS = ['🍎 Fruits', '👪 Famille', '🏠 Maison', '😊 Émotions', '🐶 Animaux', '🍽️ Repas'];

/** Free-text theme + starters (first time) or AI suggestions based on what the learner already knows. */
export function ThemePicker({ withAi = true }: { withAi?: boolean }) {
  const c = useColors();
  const { createTheme, suggestThemes } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<ThemeSuggestion[] | null>(null);
  const [loadingIdeas, setLoadingIdeas] = useState(false);

  const create = async (theme: string) => {
    const clean = theme.replace(/^\p{Extended_Pictographic}️?\s*/u, '').trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      await createTheme(clean);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadIdeas = async () => {
    setLoadingIdeas(true);
    setError(null);
    try {
      setIdeas(await suggestThemes());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingIdeas(false);
    }
  };

  const chips = ideas ? ideas.map((i) => ({ label: `${i.emoji} ${i.name}`, reason: i.reason })) : withAi ? [] : STARTERS.map((s) => ({ label: s, reason: '' }));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Un thème : cuisine, sport, école…"
          placeholderTextColor={c.muted}
          returnKeyType="go"
          onSubmitEditing={() => create(name)}
          style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }]}
        />
        <Button label="Go" onPress={() => create(name)} loading={busy} disabled={!name.trim()} style={styles.go} />
      </View>
      {withAi && !ideas ? (
        <Button label={loadingIdeas ? 'L’IA réfléchit…' : '💡 Suggère-moi des thèmes'} variant="secondary" onPress={loadIdeas} loading={loadingIdeas} />
      ) : null}
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Pressable
            key={chip.label}
            onPress={() => create(chip.label)}
            disabled={busy}
            style={({ pressed }) => [styles.chip, { borderColor: c.line, backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.chipText, { color: c.ink }]}>{chip.label}</Text>
            {chip.reason ? <Text style={[styles.reason, { color: c.muted }]}>{chip.reason}</Text> : null}
          </Pressable>
        ))}
      </View>
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {error ? <Text style={{ color: c.bad }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 },
  go: { minWidth: 64 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  chipText: { fontSize: 16, fontWeight: '700' },
  reason: { fontSize: 13, marginTop: 2 },
});
