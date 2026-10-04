import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from './colors';

/** A sign video: muted, looping, autoplaying, slowed down by the global rate. */
export function SignVideo({
  uri, poster, rate, style, credit, fit = 'contain',
}: {
  uri: string;
  fit?: 'contain' | 'cover';
  poster?: string | null;
  rate: number;
  style?: StyleProp<ViewStyle>;
  credit?: string;
}) {
  const c = useColors();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.playbackRate = rate;
  });
  // On web, play() is a no-op until the VideoView has mounted its <video>, so start from an effect.
  useEffect(() => {
    player.play();
  }, [player]);
  useEffect(() => {
    player.playbackRate = rate;
  }, [player, rate]);

  return (
    <View style={[styles.frame, { backgroundColor: c.video }, style]} pointerEvents="none">
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode={fit} /> : null}
      <VideoView player={player} style={styles.video} contentFit={fit} nativeControls={false} />
      {credit ? <Text style={styles.credit}>{credit} · Elix</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 20, overflow: 'hidden', aspectRatio: 16 / 9, width: '100%' },
  // A web <video> keeps its intrinsic size under `inset: 0` alone.
  video: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  credit: { position: 'absolute', right: 8, bottom: 6, fontSize: 10, color: '#8A8794' },
});
