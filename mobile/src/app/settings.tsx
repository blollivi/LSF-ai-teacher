import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';
import { Button, Card, Label } from '../ui/kit';

export default function Settings() {
  const c = useColors();
  const { cfg, rate, setRate, sync, syncing, syncError } = useApp();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Label>Vitesse des vidéos</Label>
      <Card style={styles.row}>
        {[0.5, 0.75, 1].map((r) => (
          <Button key={r} label={`${r}×`} variant={r === rate ? 'primary' : 'ghost'} onPress={() => setRate(r)} style={styles.rate} />
        ))}
      </Card>
      <Label>Serveur</Label>
      <Card style={styles.col}>
        <Text style={{ color: c.ink }}>{cfg?.baseUrl ?? '—'}</Text>
        {syncError ? <Text style={{ color: c.bad }}>{syncError}</Text> : <Text style={{ color: c.good }}>Connecté</Text>}
        <Button label="Synchroniser maintenant" variant="secondary" onPress={sync} loading={syncing} />
        <Button label="Changer de serveur" variant="ghost" onPress={() => router.push('/onboarding')} />
      </Card>
      <Text style={[styles.credits, { color: c.muted }]}>
        Vidéos des signes : dictionnaire Elix (Signes de sens). Les mots sont choisis par IA puis vérifiés un à un.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 8 },
  rate: { flex: 1 },
  col: { gap: 10 },
  credits: { fontSize: 13, lineHeight: 19, marginTop: 12 },
});
