import { Ionicons } from '@expo/vector-icons';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getAssignment } from '@/src/lib/appData';
import { supabase } from '@/src/lib/supabase';
import { hasMinimumRole, type AppRole } from '@/src/types/app';

export default function RootLayout() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    if (!supabase) return;

    const applySession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      setSignedIn(Boolean(session));
      if (!session?.user) {
        setRole(null);
        return;
      }
      try {
        const assignment = await getAssignment(session.user.id);
        setRole(assignment?.role ?? null);
      } catch {
        setRole(null);
      }
    };

    void supabase.auth.getSession().then(({ data }) => void applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const showQuickTools = signedIn && role !== null && pathname === '/';
  const showCommandCenter = role ? hasMinimumRole(role, 'district_manager') : false;
  const showLaborPlanner = role ? hasMinimumRole(role, 'store_manager') : false;
  const showTestSetup = role ? hasMinimumRole(role, 'owner') : false;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
      {showQuickTools ? (
        <View style={styles.quickTools} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Open AI Manager" style={[styles.toolButton, styles.primaryButton]} onPress={() => router.push('/ai-manager')}>
            <View style={[styles.iconBubble, styles.primaryIcon]}><Ionicons name="sparkles" size={17} color="#fff" /></View>
            <Text style={[styles.toolText, styles.primaryText]}>AI Manager</Text>
          </Pressable>
          {showCommandCenter ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open District Command Center" style={styles.toolButton} onPress={() => router.push('/district-command-center')}>
              <View style={styles.iconBubble}><Ionicons name="stats-chart" size={17} color="#1769e0" /></View>
              <Text style={styles.toolText}>Command Center</Text>
            </Pressable>
          ) : null}
          {showLaborPlanner ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open Labor Planner" style={styles.toolButton} onPress={() => router.push('/labor-planner')}>
              <View style={styles.iconBubble}><Ionicons name="people" size={17} color="#1769e0" /></View>
              <Text style={styles.toolText}>Labor Planner</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Open District Hub" style={styles.toolButton} onPress={() => router.push('/hub')}>
            <View style={styles.iconBubble}><Ionicons name="chatbubbles" size={17} color="#1769e0" /></View>
            <Text style={styles.toolText}>District Hub</Text>
          </Pressable>
          {showTestSetup ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open first test setup" style={styles.toolButton} onPress={() => router.push('/first-test-setup')}>
              <View style={styles.iconBubble}><Ionicons name="flask" size={17} color="#8a5a00" /></View>
              <Text style={styles.toolText}>Test Setup</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  quickTools: {
    position: 'absolute',
    right: 14,
    bottom: 82,
    gap: 8,
    alignItems: 'flex-end',
  },
  toolButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: '#e5eaf2',
    shadowColor: '#172033',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryButton: { backgroundColor: '#172033', borderColor: '#172033' },
  iconBubble: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf4ff' },
  primaryIcon: { backgroundColor: '#2f7df1' },
  toolText: { color: '#172033', fontWeight: '800', fontSize: 14 },
  primaryText: { color: '#fff' },
});
