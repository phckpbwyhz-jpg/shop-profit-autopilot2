import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getAssignment,
  getCustomKpis,
  getDailyForSellingDay,
  getDistrictStores,
  getHistoricalMonth,
  getLatestDaily,
  getMonthSettings,
  getStore,
} from '@/src/lib/appData';
import { buildManagerInsights, type InsightSeverity, type ManagerInsight } from '@/src/lib/managerInsights';
import { calculatePerformance, formatCurrency } from '@/src/lib/performance';
import { supabase } from '@/src/lib/supabase';
import type { CustomKpi, DailyPerformance, HistoricalMonth, MonthSettings, Store, UserAssignment } from '@/src/types/app';

interface StoreSnapshot {
  store: Store;
  settings: MonthSettings | null;
  daily: DailyPerformance | null;
  priorYear: HistoricalMonth | null;
  sameDayLastYear: DailyPerformance | null;
  kpis: CustomKpi[];
}

const currentPeriod = () => {
  const date = new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
};

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';

async function loadSnapshot(store: Store): Promise<StoreSnapshot> {
  const { year, month } = currentPeriod();
  const [settings, daily, priorYear, kpis] = await Promise.all([
    getMonthSettings(store.id, year, month),
    getLatestDaily(store.id, year, month),
    getHistoricalMonth(store.id, year - 1, month),
    getCustomKpis(store.id, year, month),
  ]);
  const sameDayLastYear = daily
    ? await getDailyForSellingDay(store.id, year - 1, month, daily.selling_day_number)
    : null;
  return { store, settings, daily, priorYear, sameDayLastYear, kpis };
}

function insightsFor(snapshot: StoreSnapshot): { insights: ManagerInsight[]; projection: number; goalPercent: number } {
  const input = {
    monthlySalesGoal: Number(snapshot.settings?.sales_goal ?? 0),
    mtdSales: Number(snapshot.daily?.mtd_sales ?? 0),
    laborCost: Number(snapshot.daily?.labor_cost ?? 0),
    partsCost: Number(snapshot.daily?.parts_cost ?? 0),
    carCount: Number(snapshot.daily?.car_count_mtd ?? 0),
    sellingDaysCompleted: Number(snapshot.daily?.selling_day_number ?? 0),
    totalSellingDays: Number(snapshot.settings?.selling_days_total ?? 0),
    lastYearCompletedMonthSales: snapshot.priorYear ? Number(snapshot.priorYear.sales) : undefined,
    lastYearSameSellingDaySales: snapshot.sameDayLastYear ? Number(snapshot.sameDayLastYear.mtd_sales) : undefined,
  };
  const metrics = calculatePerformance(input);
  return {
    projection: metrics.projectedMonthEnd,
    goalPercent: metrics.projectedGoalPercent,
    insights: buildManagerInsights({
      metrics,
      salesGoal: input.monthlySalesGoal,
      laborGoalPct: snapshot.settings?.labor_goal_pct ?? null,
      partsGoalPct: snapshot.settings?.parts_goal_pct ?? null,
      kpis: snapshot.kpis,
    }),
  };
}

export default function AiManagerScreen() {
  const [assignment, setAssignment] = useState<UserAssignment | null>(null);
  const [snapshots, setSnapshots] = useState<StoreSnapshot[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error('Sign in required.');
      const nextAssignment = await getAssignment(user.id);
      if (!nextAssignment) throw new Error('No active workspace assignment was found.');
      setAssignment(nextAssignment);

      let stores: Store[] = [];
      if (nextAssignment.store_id) {
        const store = await getStore(nextAssignment.store_id);
        if (store) stores = [store];
      } else if (nextAssignment.district_id) {
        stores = await getDistrictStores(nextAssignment.district_id);
      }
      if (!stores.length) throw new Error('No accessible store data is available for AI Manager.');
      const nextSnapshots = await Promise.all(stores.map(loadSnapshot));
      setSnapshots(nextSnapshots);
      setSelectedStoreId((current) => current && nextSnapshots.some((item) => item.store.id === current) ? current : nextSnapshots[0].store.id);
    } catch (error) {
      Alert.alert('AI Manager', message(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => snapshots.find((snapshot) => snapshot.store.id === selectedStoreId) ?? snapshots[0] ?? null,
    [selectedStoreId, snapshots],
  );
  const result = selected ? insightsFor(selected) : null;

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back"><Ionicons name="chevron-back" size={28} /></Pressable>
        <View style={styles.flex}><Text style={styles.eyebrow}>AI MANAGER</Text><Text style={styles.headerTitle}>Verified priorities</Text></View>
        <Ionicons name="sparkles" size={24} color="#1769e0" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>What should I focus on?</Text>
          <Text style={styles.muted}>The priorities below come from verified shop data and deterministic calculations. AI is not allowed to recalculate your accounting numbers or invent future workload.</Text>
        </View>

        {snapshots.length > 1 ? <View style={styles.card}><Text style={styles.label}>Store</Text><View style={styles.chips}>{snapshots.map((snapshot) => <Pressable key={snapshot.store.id} onPress={() => setSelectedStoreId(snapshot.store.id)} style={[styles.chip, selectedStoreId === snapshot.store.id && styles.chipOn]}><Text style={[styles.chipText, selectedStoreId === snapshot.store.id && styles.chipTextOn]}>{snapshot.store.store_code ? `${snapshot.store.store_code} · ` : ''}{snapshot.store.name}</Text></Pressable>)}</View></View> : null}

        {selected && result ? <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Projected month-end</Text><Text style={styles.summaryValue}>{formatCurrency(result.projection)}</Text></View>
            <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Projected goal</Text><Text style={styles.summaryValue}>{result.goalPercent.toFixed(1)}%</Text></View>
          </View>
          <Text style={styles.sectionTitle}>Top 3 priorities</Text>
          {result.insights.map((insight, index) => <InsightCard key={insight.id} insight={insight} rank={index + 1} />)}
          {!result.insights.length ? <View style={styles.card}><Text style={styles.cardTitle}>No priority gaps detected</Text><Text style={styles.muted}>Enter current sales, labor, parts and KPI data to generate management priorities.</Text></View> : null}
        </> : null}

        <View style={styles.coachCard}>
          <View style={styles.coachHeader}><Ionicons name="chatbubbles-outline" size={24} color="#1769e0" /><Text style={styles.cardTitle}>Ask AI Coach</Text></View>
          <Text style={styles.muted}>The coaching layer is prepared next. It will receive only RLS-authorized store context plus these verified metrics and priorities; the model will explain and coach, not become the source of truth.</Text>
          <View style={styles.locked}><Ionicons name="lock-closed" size={16} color="#667085" /><Text style={styles.lockedText}>Server AI credential not configured yet</Text></View>
        </View>

        {assignment?.district_id ? <Pressable style={styles.secondaryButton} onPress={() => router.push('/hub')}><Ionicons name="people-outline" size={20} color="#1769e0" /><Text style={styles.secondaryText}>Open District Hub</Text></Pressable> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InsightCard({ insight, rank }: { insight: ManagerInsight; rank: number }) {
  return <View style={[styles.card, styles.insightCard]}><View style={styles.rank}><Text style={styles.rankText}>{rank}</Text></View><View style={styles.flex}><View style={styles.insightTop}><Text style={styles.cardTitle}>{insight.title}</Text><SeverityBadge severity={insight.severity} /></View><Text style={styles.detail}>{insight.detail}</Text><Text style={styles.actionLabel}>Recommended action</Text><Text style={styles.action}>{insight.action}</Text></View></View>;
}

function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const label: Record<InsightSeverity, string> = { critical: 'Act now', warning: 'Watch', opportunity: 'Opportunity', positive: 'On pace' };
  return <View style={[styles.badge, severity === 'critical' && styles.badgeCritical, severity === 'positive' && styles.badgePositive]}><Text style={styles.badgeText}>{label[severity]}</Text></View>;
}

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f5f7fb'},center:{flex:1,alignItems:'center',justifyContent:'center'},header:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:18,paddingVertical:12,backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#e6eaf0'},flex:{flex:1},eyebrow:{fontSize:11,fontWeight:'800',letterSpacing:1.2,color:'#1769e0'},headerTitle:{fontSize:20,fontWeight:'800',color:'#172033'},scroll:{padding:18,paddingBottom:60,gap:14},hero:{backgroundColor:'#eaf2ff',padding:18,borderRadius:18,gap:8},heroTitle:{fontSize:24,fontWeight:'900',color:'#172033'},muted:{color:'#667085',lineHeight:20},card:{backgroundColor:'#fff',borderRadius:16,padding:16,borderWidth:1,borderColor:'#e6eaf0',gap:9},label:{fontSize:12,fontWeight:'800',color:'#475467',textTransform:'uppercase'},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{borderWidth:1,borderColor:'#d0d5dd',borderRadius:10,paddingHorizontal:11,paddingVertical:8},chipOn:{backgroundColor:'#eaf2ff',borderColor:'#1769e0'},chipText:{fontWeight:'700',color:'#475467'},chipTextOn:{color:'#1769e0'},summaryRow:{flexDirection:'row',gap:10},summaryCard:{flex:1,backgroundColor:'#fff',padding:14,borderRadius:14,borderWidth:1,borderColor:'#e6eaf0'},summaryLabel:{fontSize:12,color:'#667085',fontWeight:'700'},summaryValue:{fontSize:22,fontWeight:'900',color:'#172033',marginTop:5},sectionTitle:{fontSize:19,fontWeight:'900',color:'#172033',marginTop:2},insightCard:{flexDirection:'row',gap:12},rank:{width:32,height:32,borderRadius:16,backgroundColor:'#172033',alignItems:'center',justifyContent:'center'},rankText:{color:'#fff',fontWeight:'900'},insightTop:{gap:7},cardTitle:{fontSize:17,fontWeight:'800',color:'#172033'},detail:{color:'#475467',lineHeight:20},actionLabel:{fontSize:11,fontWeight:'900',color:'#1769e0',textTransform:'uppercase',marginTop:2},action:{color:'#172033',lineHeight:21,fontWeight:'600'},badge:{alignSelf:'flex-start',borderRadius:999,paddingHorizontal:8,paddingVertical:4,backgroundColor:'#fff4e5'},badgeCritical:{backgroundColor:'#feeceb'},badgePositive:{backgroundColor:'#eaf8ef'},badgeText:{fontSize:11,fontWeight:'800',color:'#475467'},coachCard:{backgroundColor:'#fff',borderRadius:16,padding:16,borderWidth:1,borderColor:'#cfe0ff',gap:10},coachHeader:{flexDirection:'row',alignItems:'center',gap:8},locked:{flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#f2f4f7',padding:10,borderRadius:10},lockedText:{fontSize:13,fontWeight:'700',color:'#667085'},secondaryButton:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:13,borderRadius:12,borderWidth:1,borderColor:'#b8cdf5',backgroundColor:'#fff'},secondaryText:{fontWeight:'800',color:'#1769e0'}
});
