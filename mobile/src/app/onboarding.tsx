import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { guessBaseUrl, useApp } from '../state/AppContext';
import { useColors } from '../ui/colors';
import { Button, Label } from '../ui/kit';

export default function Onboarding() {
  const c = useColors();
  const { cfg, saveConfig } = useApp();
  const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl ?? guessBaseUrl());
  const [token, setToken] = useState(cfg?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const conf = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), token: token.trim() };
    try {
      await api.listThemes(conf);
      await saveConfig(conf);
      router.replace('/');
    } catch (e) {
      setError(`Connexion impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.card }];
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>🤟</Text>
          <Text style={[styles.title, { color: c.ink }]}>LSF Flash</Text>
          <Text style={[styles.sub, { color: c.muted }]}>
            Apprends le vocabulaire de la langue des signes française, un signe à la fois.
          </Text>
          <View style={styles.form}>
            <Label>Adresse du serveur</Label>
            <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
            <Label>Jeton d'accès (APP_TOKEN)</Label>
            <TextInput value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
            {error ? <Text style={{ color: c.bad }}>{error}</Text> : null}
            <Button label="Se connecter" onPress={connect} loading={busy} disabled={!baseUrl.trim()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 8, flexGrow: 1, justifyContent: 'center' },
  logo: { fontSize: 72, textAlign: 'center' },
  title: { fontSize: 34, fontWeight: '900', textAlign: 'center' },
  sub: { fontSize: 17, textAlign: 'center', lineHeight: 24, marginBottom: 24 },
  form: { gap: 10 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 16, marginBottom: 6 },
});
