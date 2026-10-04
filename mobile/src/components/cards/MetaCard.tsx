import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Meta } from '../../engine/types';
import { useApp } from '../../state/AppContext';
import { useColors } from '../../ui/colors';
import { Button, Card, Label, ProgressBar } from '../../ui/kit';
import { ThemePicker } from '../ThemePicker';

export function MetaCard({ meta, onNext }: { meta: Meta; onNext: () => void }) {
  const c = useColors();
  const { extendTheme, acquired } = useApp();
  const [extending, setExtending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const extend = async (themeId: number) => {
    setExtending(themeId);
    setError(null);
    try {
      await extendTheme(themeId, 10);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setExtending(null);
    }
  };

  const title = (emoji: string, text: string, sub?: string) => (
    <View style={styles.head}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.title, { color: c.ink }]}>{text}</Text>
      {sub ? <Text style={[styles.sub, { color: c.muted }]}>{sub}</Text> : null}
    </View>
  );

  switch (meta.type) {
    case 'no_theme':
      return (
        <View style={styles.wrap}>
          {title('👋', 'Choisis ton premier thème', "L'IA prépare une liste de mots, chacun vérifié avec sa vidéo dans le dictionnaire Elix.")}
          <ThemePicker withAi={false} />
        </View>
      );

    case 'preparing':
      return (
        <View style={styles.wrap}>
          {title('🧠', 'L’IA prépare tes mots…', 'Chaque mot est vérifié et sa vidéo téléchargée avant de t’être proposé.')}
          {meta.themes.map((t) => (
            <Card key={t.id} style={styles.themeRow}>
              <Text style={[styles.themeName, { color: c.ink }]}>
                {t.emoji} {t.name}
              </Text>
              <ProgressBar value={t.activeCount / Math.max(t.targetActive, 1)} color={c.accent} />
              <Text style={{ color: c.muted }}>
                {t.activeCount} / {t.targetActive} mots prêts
              </Text>
            </Card>
          ))}
          <ActivityIndicator color={c.accent} />
        </View>
      );

    case 'recap':
      return (
        <View style={styles.wrap}>
          {title('📈', 'Petit bilan')}
          <Card style={styles.stats}>
            <Stat label="Réponses justes" value={`${meta.correct}/${meta.answered}`} />
            <Stat label="Meilleur combo" value={`${meta.bestCombo}`} />
            <Stat label="Mots acquis" value={`${meta.acquiredTotal}`} />
          </Card>
          <Button label="On continue !" onPress={onNext} />
        </View>
      );

    case 'theme_mastered':
      return (
        <View style={styles.wrap}>
          {title('🏆', `${meta.theme.emoji} ${meta.theme.name} : maîtrisé !`, `${meta.acquired} mots acquis dans ce thème. Et maintenant ?`)}
          <Button label="➕ 10 mots de plus sur ce thème" onPress={() => extend(meta.theme.id)} loading={extending === meta.theme.id} />
          <Label>ou un nouveau thème</Label>
          <ThemePicker />
          <Button label="Continuer les révisions" variant="ghost" onPress={onNext} />
          {error ? <Text style={{ color: c.bad }}>{error}</Text> : null}
        </View>
      );

    case 'all_done': {
      const open = meta.themes.filter((t) => !t.paused && t.status !== 'failed');
      return (
        <View style={styles.wrap}>
          {title('🎉', 'Tout est à jour !', `${acquired} mots acquis. Tes prochaines révisions arrivent plus tard — envie de nouveaux mots ?`)}
          {open.map((t) => (
            <Button
              key={t.id}
              label={`➕ 10 mots : ${t.emoji} ${t.name}`}
              variant="secondary"
              onPress={() => extend(t.id)}
              loading={extending === t.id}
            />
          ))}
          <Label>ou un nouveau thème</Label>
          <ThemePicker />
          {error ? <Text style={{ color: c.bad }}>{error}</Text> : null}
        </View>
      );
    }
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.ink }]}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  head: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  emoji: { fontSize: 56 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  themeRow: { gap: 8 },
  themeName: { fontSize: 17, fontWeight: '700' },
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 28, fontWeight: '800' },
});
