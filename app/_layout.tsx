import { Ionicons } from '@expo/vector-icons';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
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

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
      {signedIn && pathname !== '/hub' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open District Hub" style={styles.hubButton} onPress={() => router.push('/hub')}>
          <Ionicons name="chatbubbles" size={18} color="#fff" />
          <Text style={styles.hubText}>Hub</Text>
        </Pressable>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  hubButton: {
    position: 'absolute',
    right: 16,
    bottom: 82,
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
  hubText: { color: '#fff', fontWeight: '800' },
});
