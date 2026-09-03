import { Ionicons } from '@expo/vector-icons';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from '@/src/lib/supabase';

export default function RootLayout() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  const showQuickTools = signedIn && pathname === '/';

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
      {showQuickTools ? (
        <View style={styles.quickTools} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Open AI Manager" style={[styles.toolButton, styles.aiButton]} onPress={() => router.push('/ai-manager')}>
            <Ionicons name="sparkles" size={18} color="#fff" />
            <Text style={styles.toolText}>AI Manager</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open District Command Center" style={styles.toolButton} onPress={() => router.push('/district-command-center')}>
            <Ionicons name="stats-chart" size={18} color="#fff" />
            <Text style={styles.toolText}>Command Center</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Labor Planner" style={styles.toolButton} onPress={() => router.push('/labor-planner')}>
            <Ionicons name="people" size={18} color="#fff" />
            <Text style={styles.toolText}>Labor Planner</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open District Hub" style={styles.toolButton} onPress={() => router.push('/hub')}>
            <Ionicons name="chatbubbles" size={18} color="#fff" />
            <Text style={styles.toolText}>Hub</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  quickTools: {
    position: 'absolute',
    right: 16,
    bottom: 82,
    gap: 9,
    alignItems: 'flex-end',
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#1769e0',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  aiButton: { backgroundColor: '#172033' },
  toolText: { color: '#fff', fontWeight: '800' },
});
