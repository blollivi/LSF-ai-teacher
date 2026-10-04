import { Redirect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DiscoveryCard } from '../components/cards/DiscoveryCard';
import { MetaCard } from '../components/cards/MetaCard';
import { VideoToWordCard } from '../components/cards/VideoToWordCard';
import { WordToVideoCard } from '../components/cards/WordToVideoCard';
import { FeedHeader } from '../components/FeedHeader';
import { useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';

export default function Feed() {
  const c = useColors();
  const { ready, cfg, card, session, rate, next, discover, answer } = useApp();
  const onNext = useCallback(() => next(), [next]);

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (!cfg) return <Redirect href="/onboarding" />;

  let body = null;
  if (card?.kind === 'discovery') {
    body = <DiscoveryCard item={card.item} rate={rate} onDone={() => discover(card.item)} />;
  } else if (card?.kind === 'quiz') {
    const Quiz = card.dir === 'R' ? VideoToWordCard : WordToVideoCard;
    body = <Quiz card={card} rate={rate} onAnswer={(ok, ms) => answer(card, ok, ms)} onNext={onNext} />;
  } else if (card?.kind === 'meta') {
    body = <MetaCard meta={card.meta} onNext={onNext} />;
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <FeedHeader />
      </View>
      {/* key = card index: each card mounts fresh (new video players, reset answer state) */}
      <ScrollView key={session.cardIndex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.line }]}>{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  content: { padding: 16, paddingTop: 4, paddingBottom: 48 },
  card: { borderRadius: 28, borderWidth: 1, padding: 18 },
});
