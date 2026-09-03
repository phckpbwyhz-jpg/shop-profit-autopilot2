import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MetricCard } from '@/src/components/MetricCard';
import { getAssignment, getCustomKpis, getDailyForSellingDay, getDistrictStores, getHistoricalMonth, getLatestDaily, getMonthSettings } from '@/src/lib/appData';
import { buildDistrictCommandCenter, type DistrictStoreSnapshot } from '@/src/lib/districtInsights';
import { calculatePerformance, formatCurrency, formatPercent } from '@/src/lib/performance';
import { supabase } from '@/src/lib/supabase';
import { hasMinimumRole, type Store } from '@/src/types/app';
import type { PerformanceInput } from '@/src/types/performance';

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

async function loadSnapshot(store: Store): Promise<DistrictStoreSnapshot> {
  const { year, month } = currentYearMonth();
  const [settings, daily, priorYear, kpis] = await Promise.all([
    getMonthSettings(store.id, year, month),
    getLatestDaily(store.id, year, month),
    getHistoricalMonth(store.id, year - 1, month),
    getCustomKpis(store.id, year, month),
  ]);
  const sameDayLastYear = daily
    ? await getDailyForSellingDay(store.id, year - 1, month, daily.selling_day_number)
    : null;
  const input: PerformanceInput = {
    monthlySalesGoal: Number(settings?.sales_goal ?? 0),
    mtdSales: Number(daily?.mtd_sales ?? 0),
    laborCost: Number(daily?.labor_cost ?? 0),
    partsCost: Number(daily?.parts_cost ?? 0),
    carCount: Number(daily?.car_count_mtd ?? 0),
    sellingDaysCompleted: Number(daily?.selling_day_number ?? 0),
    totalSellingDays: Number(settings?.selling_days_total ?? 0),
    lastYearCompletedMonthSales: priorYear ? Number(priorYear.sales) : undefined,
    lastYearSameSellingDaySales: sameDayLastYear ? Number(sameDayLastYear.mtd_sales) : undefined,
  };
  return {
    store,
    settings,
    metrics: calculatePerformance(input),
    mtdSales: input.mtdSales,
    laborCost: input.laborCost,
    partsCost: input.partsCost,
    kpis,
  };
}

export default function DistrictCommandCenterScreen() {
  const [snapshots, setSnapshots] = useState<DistrictStoreSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [authorized, setAuthorized] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!supabase) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!data.user) throw new Error('Sign in is required.');
      const assignment = await getAssignment(data.user.id);
      if (!assignment || !hasMinimumRole(assignment.role, 'district_manager') || !assignment.district_id) {
        setAuthorized(false);
        setSnapshots([]);
        return;
      }
      setAuthorized(true);
      const stores = await getDistrictStores(assignment.district_id);
      setSnapshots(await Promise.all(stores.map(loadSnapshot)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the district command center.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const command = useMemo(() => buildDistrictCommandCenter(snapshots), [snapshots]);

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!authorized) return (
    <SafeAreaView style={styles.center}>
      <Ionicons name="lock-closed-outline" size={36} />
      <Text style={styles.title}>District access required</Text>
      <Text style={styles.muted}>This command center is available to District Managers and authorized leadership.</Text>
      <Text style={styles.link} onPress={() => router.back()}>Go back</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}>
        <Text style={styles.eyebrow}>DISTRICT COMMAND CENTER</Text>
        <Text style={styles.title}>Where should I spend my time today?</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.grid}>
          <MetricCard label="District MTD sales" value={formatCurrency(command.totalMtdSales)} />
          <MetricCard label="District sales goal" value={formatCurrency(command.totalSalesGoal)} />
          <MetricCard label="Projected month-end" value={formatCurrency(command.projectedMonthEnd)} />
          <MetricCard label="Projected goal" value={`${command.projectedGoalPercent.toFixed(1)}%`} />
          <MetricCard label="Weighted labor" value={`${command.laborPercent.toFixed(1)}%`} />
          <MetricCard label="Weighted parts" value={`${command.partsPercent.toFixed(1)}%`} />
          <MetricCard label="Stores on pace" value={`${command.storesOnPace} / ${command.storeCount}`} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Top 3 District Priorities</Text>
          {command.priorities.map((priority, index) => (
            <View key={priority.id} style={styles.priority}>
              <Text style={styles.priorityTitle}>{index + 1}. {priority.title}</Text>
              <Text style={styles.muted}>{priority.detail}</Text>
              <Text style={styles.body}>Action: {priority.action}</Text>
            </View>
          ))}
          {!command.priorities.length ? <Text style={styles.muted}>Add current store goals and daily check-ins to generate verified priorities.</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Store Ranking</Text>
          <Text style={styles.muted}>Ranked against each store's own goals, with labor and parts discipline included. Raw sales volume alone does not determine rank.</Text>
          {command.rankings.map((store, index) => (
            <View key={store.storeId} style={styles.storeRow}>
              <View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View>
              <View style={styles.storeInfo}>
                <Text style={styles.priorityTitle}>{store.storeName}</Text>
                <Text style={styles.muted}>{store.projectedGoalPercent.toFixed(1)}% of goal · Labor {store.laborPercent.toFixed(1)}% · Parts {store.partsPercent.toFixed(1)}%</Text>
                <Text style={styles.muted}>Same-day TY/LY {formatPercent(store.sameDayYearOverYearPercent)}</Text>
              </View>
              <View style={styles.right}><Text style={styles.projection}>{formatCurrency(store.projectedMonthEnd)}</Text><Text style={styles.muted}>projected</Text></View>
            </View>
          ))}
          {!command.rankings.length ? <Text style={styles.muted}>No active stores are visible in this district.</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#f5f7fa' },
  scroll: { padding: 20, paddingBottom: 40, gap: 14 },
  eyebrow: { color: '#1769e0', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#14213d', fontSize: 27, fontWeight: '900', textAlign: 'center' },
  sectionTitle: { color: '#14213d', fontSize: 18, fontWeight: '900' },
  priorityTitle: { color: '#14213d', fontSize: 16, fontWeight: '800' },
  muted: { color: '#637083', fontSize: 14, lineHeight: 20 },
  body: { color: '#34445c', fontSize: 14, lineHeight: 21 },
  error: { color: '#a43e3e', fontSize: 14 },
  link: { color: '#1769e0', fontWeight: '800', padding: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { padding: 18, borderRadius: 16, backgroundColor: '#fff', gap: 12 },
  priority: { gap: 5, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#edf1f6' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#edf1f6' },
  rank: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf1f6' },
  rankText: { color: '#14213d', fontWeight: '900' },
  storeInfo: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end' },
  projection: { color: '#1769e0', fontSize: 16, fontWeight: '900' },
});
