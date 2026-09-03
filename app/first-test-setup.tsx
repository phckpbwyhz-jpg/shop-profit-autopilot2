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

type ProvisionedAccount = {
  key: string;
  email: string;
  password?: string;
  created: boolean;
};

export default function FirstTestSetupScreen() {
  const [assignment, setAssignment] = useState<UserAssignment | null>(null);
  const [primaryCode, setPrimaryCode] = useState('244');
  const [loading, setLoading] = useState(true);
  const [seedBusy, setSeedBusy] = useState(false);
  const [accountsBusy, setAccountsBusy] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const [accounts, setAccounts] = useState<ProvisionedAccount[]>([]);

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
    setSeedBusy(true);
    const { data, error } = await supabase.functions.invoke('seed-phoenix-central-test', {
      body: { primary_store_code: primaryCode },
    });
    setSeedBusy(false);
    if (error) {
      Alert.alert('Test setup blocked', error.message);
      return;
    }
    if (data?.error) {
      Alert.alert('Test setup blocked', String(data.error));
      return;
    }
    setSeedDone(true);
    Alert.alert('Phoenix Central ready', 'Seven stores and the Sept. 3 real-world test data are ready.');
  }

  async function provisionAccounts() {
    if (!supabase || !authorized) return;
    setAccountsBusy(true);
    const { data, error } = await supabase.functions.invoke('provision-test-role-accounts', {
      body: { store_code: primaryCode },
    });
    setAccountsBusy(false);
    if (error) {
      Alert.alert('Account setup blocked', error.message);
      return;
    }
    if (data?.error) {
      Alert.alert('Account setup blocked', String(data.error));
      return;
    }
    const nextAccounts = Array.isArray(data?.accounts) ? data.accounts as ProvisionedAccount[] : [];
    setAccounts(nextAccounts);
    Alert.alert('Test accounts ready', 'Store Manager and District Manager test roles are configured. Save any newly generated passwords shown on this screen.');
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!authorized) return (
    <SafeAreaView style={styles.center}>
      <Ionicons name="lock-closed-outline" size={38} />
      <Text style={styles.title}>Owner access required</Text>
      <Text style={styles.muted}>Only an Owner or Admin can prepare the protected first-test workspace.</Text>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>Go back</Text></Pressable>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>FIRST REAL-WORLD TEST</Text>
        <Text style={styles.title}>Prepare Phoenix Central</Text>
        <Text style={styles.muted}>Load the verified seven-store Sept. 3 district fixture, then create separate Store Manager and District Manager test logins. No official monthly sales goals or same-selling-day prior-year values are invented.</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. Choose the Store Manager test store</Text>
          <Text style={styles.muted}>This store becomes your Owner account's default store and the dedicated Store Manager test account's store. The District Manager test account remains district-wide.</Text>
          <View style={styles.storeChoices}>
            {STORES.map(([code, name]) => (
              <Pressable key={code} style={[styles.choice, primaryCode === code && styles.choiceActive]} onPress={() => setPrimaryCode(code)}>
                <Text style={[styles.choiceText, primaryCode === code && styles.choiceTextActive]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. Load the real district fixture</Text>
          <Text style={styles.row}>• Requires an authenticated Owner/Admin.</Text>
          <Text style={styles.row}>• Blocks seeding over an unrelated district that already contains live daily data.</Text>
          <Text style={styles.row}>• Uses 25 September selling days and the verified morning MTD, labor, parts, car count, and prior-year totals.</Text>
          <Text style={styles.row}>• Records the action in the audit log.</Text>
          <Pressable style={[styles.button, seedBusy && styles.disabled]} disabled={seedBusy} onPress={() => void seed()}>
            <Text style={styles.buttonText}>{seedBusy ? 'Preparing test district…' : seedDone ? 'Reload Phoenix Central Test Data' : 'Load Phoenix Central Test Data'}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>3. Create the two role test logins</Text>
          <Text style={styles.muted}>Creates or reuses one Store Manager account for {STORES.find(([code]) => code === primaryCode)?.[1]} and one District Manager account for the full Phoenix Central district.</Text>
          <Pressable style={[styles.secondaryButton, accountsBusy && styles.disabled]} disabled={accountsBusy} onPress={() => void provisionAccounts()}>
            <Text style={styles.secondaryButtonText}>{accountsBusy ? 'Creating test logins…' : 'Create / Verify Test Logins'}</Text>
          </Pressable>
          {accounts.length ? (
            <View style={styles.credentialsBox}>
              <Text style={styles.credentialsTitle}>Test login credentials</Text>
              <Text style={styles.warning}>Passwords appear only when an account is newly created. Existing accounts are not automatically reset.</Text>
              {accounts.map((account) => (
                <View key={account.key} style={styles.accountRow}>
                  <Text style={styles.accountRole}>{account.key === 'store_manager' ? 'Store Manager' : 'District Manager'}</Text>
                  <Text selectable style={styles.credential}>Email: {account.email}</Text>
                  <Text selectable style={styles.credential}>Password: {account.password ?? 'Existing account — password unchanged'}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

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
  secondaryButton: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#172033' },
  disabled: { opacity: 0.55 },
  buttonText: { color: '#fff', fontWeight: '900' },
  secondaryButtonText: { color: '#fff', fontWeight: '900' },
  credentialsBox: { backgroundColor: '#f5f7fa', borderRadius: 12, padding: 14, gap: 10 },
  credentialsTitle: { color: '#14213d', fontSize: 16, fontWeight: '900' },
  warning: { color: '#8a5b15', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  accountRow: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#dfe5ed' },
  accountRole: { color: '#14213d', fontWeight: '900' },
  credential: { color: '#34445c', fontSize: 13, lineHeight: 19 },
  link: { color: '#1769e0', fontWeight: '800', textAlign: 'center', padding: 8 },
});
