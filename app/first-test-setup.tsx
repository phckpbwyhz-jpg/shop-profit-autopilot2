import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAssignment } from '@/src/lib/appData';
import { supabase } from '@/src/lib/supabase';
import type { UserAssignment } from '@/src/types/app';

const STORES = [
  ['122', '122-Thomas'],
  ['128', '128-Ray Rd.'],
  ['146', '146-Hayden'],
  ['148', '148-Scottsdale'],
  ['236', '236-Lower Buckeye'],
  ['240', '240-24th'],
  ['244', '244-Baseline'],
] as const;

export default function FirstTestSetupScreen() {
  const [assignment, setAssignment] = useState<UserAssignment | null>(null);
  const [primaryCode, setPrimaryCode] = useState('244');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      if (data.user) setAssignment(await getAssignment(data.user.id));
      setLoading(false);
    })();
  }, []);

  const authorized = assignment?.role === 'owner' || assignment?.role === 'admin';

  async function seed() {
    if (!supabase || !authorized) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('seed-phoenix-central-test', {
      body: { primary_store_code: primaryCode },
    });
    setBusy(false);
    if (error) {
      Alert.alert('Test setup blocked', error.message);
      return;
    }
    if (data?.error) {
      Alert.alert('Test setup blocked', String(data.error));
      return;
    }
    setDone(true);
    Alert.alert('Phoenix Central ready', 'Seven stores and the Sept. 3 real-world test data are ready.');
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!authorized) return (
    <SafeAreaView style={styles.center}>
      <Ionicons name="lock-closed-outline" size={38} />
      <Text style={styles.title}>Owner access required</Text>
      <Text style={styles.muted}>Only an Owner or Admin can load the protected first-test fixture.</Text>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>Go back</Text></Pressable>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>FIRST REAL-WORLD TEST</Text>
        <Text style={styles.title}>Prepare Phoenix Central</Text>
        <Text style={styles.muted}>This is a one-purpose test tool. It loads the seven stores and verified Sept. 3 numbers provided for Phoenix Central. It does not invent official monthly sales goals or same-selling-day prior-year data.</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Choose your default store</Text>
          <Text style={styles.muted}>Your Owner account will keep district-wide access and use this store when you open store-scoped tools.</Text>
          <View style={styles.storeChoices}>
            {STORES.map(([code, name]) => (
              <Pressable key={code} style={[styles.choice, primaryCode === code && styles.choiceActive]} onPress={() => setPrimaryCode(code)}>
                <Text style={[styles.choiceText, primaryCode === code && styles.choiceTextActive]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Safety checks</Text>
          <Text style={styles.row}>• Requires an authenticated Owner/Admin.</Text>
          <Text style={styles.row}>• Blocks seeding over an unrelated district that already contains live daily data.</Text>
          <Text style={styles.row}>• Uses 25 September selling days and the verified morning MTD, labor, parts, car count, and prior-year totals.</Text>
          <Text style={styles.row}>• Records the action in the audit log.</Text>
        </View>

        <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => void seed()}>
          <Text style={styles.buttonText}>{busy ? 'Preparing test district…' : done ? 'Reload Phoenix Central Test Data' : 'Load Phoenix Central Test Data'}</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back to dashboard</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#f5f7fa' },
  scroll: { padding: 22, gap: 16, paddingBottom: 42 },
  eyebrow: { color: '#1769e0', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#14213d', fontSize: 28, fontWeight: '900' },
  sectionTitle: { color: '#14213d', fontSize: 18, fontWeight: '900' },
  muted: { color: '#637083', fontSize: 14, lineHeight: 21 },
  row: { color: '#34445c', fontSize: 14, lineHeight: 22 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 },
  storeChoices: { gap: 8 },
  choice: { borderWidth: 1, borderColor: '#d7dee8', borderRadius: 11, padding: 12, backgroundColor: '#fff' },
  choiceActive: { borderColor: '#1769e0', backgroundColor: '#eaf2ff' },
  choiceText: { color: '#34445c', fontWeight: '700' },
  choiceTextActive: { color: '#1769e0', fontWeight: '900' },
  button: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1769e0' },
  disabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontWeight: '900' },
  link: { color: '#1769e0', fontWeight: '800', textAlign: 'center', padding: 8 },
});
