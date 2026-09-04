import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import {
  buildManagerInsights,
  type InsightSeverity,
  type ManagerInsight,
} from '@/src/lib/managerInsights';
import { calculatePerformance, formatCurrency } from '@/src/lib/performance';
import { supabase } from '@/src/lib/supabase';
import type {
  CustomKpi,
  DailyPerformance,
  HistoricalMonth,
  MonthSettings,
  Store,
  UserAssignment,
} from '@/src/types/app';

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

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';

async function loadSnapshot(store: Store): Promise<StoreSnapshot> {
  const { year, month } = currentPeriod();
  const [settings, daily, priorYear, kpis] = await Promise.all([
    getMonthSettings(store.id, year, month),
    getLatestDaily(store.id, year, month),
    getHistoricalMonth(store.id, year - 1, month),
    getCustomKpis(store.id, year, month),
  ]);
  const sameDayLastYear = daily
    ? await getDailyForSellingDay(
        store.id,
        year - 1,
        month,
        daily.selling_day_number,
      )
    : null;
  return { store, settings, daily, priorYear, sameDayLastYear, kpis };
}

function insightsFor(snapshot: StoreSnapshot): {
  insights: ManagerInsight[];
  projection: number;
  goalPercent: number;
  goalConfigured: boolean;
} {
  const input = {
    monthlySalesGoal: Number(snapshot.settings?.sales_goal ?? 0),
    mtdSales: Number(snapshot.daily?.mtd_sales ?? 0),
    laborCost: Number(snapshot.daily?.labor_cost ?? 0),
    partsCost: Number(snapshot.daily?.parts_cost ?? 0),
    carCount: Number(snapshot.daily?.car_count_mtd ?? 0),
    sellingDaysCompleted: Number(snapshot.daily?.selling_day_number ?? 0),
    totalSellingDays: Number(snapshot.settings?.selling_days_total ?? 0),
    lastYearCompletedMonthSales: snapshot.priorYear
      ? Number(snapshot.priorYear.sales)
      : undefined,
    lastYearSameSellingDaySales: snapshot.sameDayLastYear
      ? Number(snapshot.sameDayLastYear.mtd_sales)
      : undefined,
  };
  const metrics = calculatePerformance(input);
  return {
    projection: metrics.projectedMonthEnd,
    goalPercent: metrics.projectedGoalPercent,
    goalConfigured: input.monthlySalesGoal > 0,
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
  const [question, setQuestion] = useState('');
  const [coachAnswer, setCoachAnswer] = useState('');
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error('Sign in required.');
      const nextAssignment = await getAssignment(user.id);
      if (!nextAssignment)
        throw new Error('No active workspace assignment was found.');
      setAssignment(nextAssignment);

      let stores: Store[] = [];
      if (nextAssignment.store_id) {
        const store = await getStore(nextAssignment.store_id);
        if (store) stores = [store];
      } else if (nextAssignment.district_id) {
        stores = await getDistrictStores(nextAssignment.district_id);
      }
      if (!stores.length)
        throw new Error('No accessible store data is available for AI Manager.');
      const nextSnapshots = await Promise.all(stores.map(loadSnapshot));
      setSnapshots(nextSnapshots);
      setSelectedStoreId((current) =>
        current && nextSnapshots.some((item) => item.store.id === current)
          ? current
          : nextSnapshots[0].store.id,
      );
    } catch (error) {
      Alert.alert('AI Manager', message(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () =>
      snapshots.find((snapshot) => snapshot.store.id === selectedStoreId) ??
      snapshots[0] ??
      null,
    [selectedStoreId, snapshots],
  );
  const result = selected ? insightsFor(selected) : null;

  async function askCoach() {
    if (!supabase || !selected) return;
    if (!question.trim()) {
      Alert.alert('Ask AI Coach', 'Enter a management question first.');
      return;
    }
    setAsking(true);
    setCoachAnswer('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-manager-coach', {
        body: { store_id: selected.store.id, question: question.trim() },
      });
      if (error) throw error;
      if (!data?.answer) throw new Error(data?.error ?? 'AI Coach returned no answer.');
      setCoachAnswer(String(data.answer));
    } catch (error) {
      Alert.alert('AI Coach unavailable', message(error));
    } finally {
      setAsking(false);
    }
  }

  if (loading)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#1769e0" />
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="#172033" />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>AI MANAGER</Text>
          <Text style={styles.headerTitle}>Verified priorities</Text>
        </View>
        <View style={styles.sparkleBubble}>
          <Ionicons name="sparkles" size={21} color="#1769e0" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="navigate" size={20} color="#fff" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.heroTitle}>What should I focus on?</Text>
            <Text style={styles.heroText}>
              Verified shop data first. AI helps explain the numbers and turn them into action.
            </Text>
          </View>
        </View>

        {snapshots.length > 1 ? (
          <View style={styles.card}>
            <Text style={styles.label}>Store</Text>
            <View style={styles.chips}>
              {snapshots.map((snapshot) => (
                <Pressable
                  key={snapshot.store.id}
                  onPress={() => {
                    setSelectedStoreId(snapshot.store.id);
                    setCoachAnswer('');
                  }}
                  style={[
                    styles.chip,
                    selectedStoreId === snapshot.store.id && styles.chipOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedStoreId === snapshot.store.id && styles.chipTextOn,
                    ]}
                  >
                    {snapshot.store.store_code ? `${snapshot.store.store_code} · ` : ''}
                    {snapshot.store.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {selected && result ? (
          <>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, styles.summaryCardPrimary]}>
                <Text style={styles.summaryLabelPrimary}>Projected month-end</Text>
                <Text style={styles.summaryValuePrimary}>{formatCurrency(result.projection)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Projected goal</Text>
                <Text style={result.goalConfigured ? styles.summaryValue : styles.summaryValueSmall}>
                  {result.goalConfigured ? `${result.goalPercent.toFixed(1)}%` : 'Not configured'}
                </Text>
              </View>
            </View>

            {!result.goalConfigured ? (
              <View style={styles.noticeCard}>
                <Ionicons name="information-circle" size={19} color="#8a5a00" />
                <Text style={styles.noticeText}>Sales goal is not configured. Goal-based warnings stay off until a verified goal is entered.</Text>
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Top priorities</Text>
              <View style={styles.verifiedPill}>
                <Ionicons name="checkmark-circle" size={14} color="#18794e" />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            </View>

            {result.insights.map((insight, index) => (
              <InsightCard key={insight.id} insight={insight} rank={index + 1} />
            ))}
            {!result.insights.length ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>No priority gaps detected</Text>
                <Text style={styles.muted}>
                  Enter current labor, parts, KPI and verified goal data to generate management priorities.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.coachCard}>
          <View style={styles.coachHeader}>
            <View style={styles.coachIcon}>
              <Ionicons name="chatbubbles" size={20} color="#fff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Ask AI Coach</Text>
              <Text style={styles.coachSubtitle}>What-if math, coaching ideas, and shop priorities</Text>
            </View>
          </View>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Example: If I do $10,000 tomorrow with no added labor cost, what happens to labor %?"
            placeholderTextColor="#98a2b3"
            multiline
            maxLength={2000}
            style={styles.questionInput}
          />
          <Pressable
            onPress={() => void askCoach()}
            disabled={asking}
            style={[styles.askButton, asking && styles.disabled]}
          >
            {asking ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={18} color="#fff" />}
            <Text style={styles.askButtonText}>{asking ? 'Analyzing…' : 'Ask AI Coach'}</Text>
          </Pressable>
          {coachAnswer ? (
            <View style={styles.answerBox}>
              <View style={styles.answerHeader}>
                <Ionicons name="sparkles" size={15} color="#1769e0" />
                <Text style={styles.answerLabel}>AI COACH</Text>
              </View>
              <Text style={styles.answerText}>{coachAnswer}</Text>
            </View>
          ) : null}
          <View style={styles.guardrailRow}>
            <Ionicons name="shield-checkmark-outline" size={15} color="#98a2b3" />
            <Text style={styles.guardrail}>
              AI does not assume future workload, open ROs, customer intent, or technician availability.
            </Text>
          </View>
        </View>

        {assignment?.district_id ? (
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/hub')}>
            <Ionicons name="people-outline" size={20} color="#1769e0" />
            <Text style={styles.secondaryText}>Open District Hub</Text>
            <Ionicons name="chevron-forward" size={18} color="#1769e0" />
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InsightCard({ insight, rank }: { insight: ManagerInsight; rank: number }) {
  return (
    <View style={[styles.card, styles.insightCard]}>
      <View style={styles.rank}><Text style={styles.rankText}>{rank}</Text></View>
      <View style={styles.flex}>
        <View style={styles.insightTop}>
          <Text style={styles.cardTitle}>{insight.title}</Text>
          <SeverityBadge severity={insight.severity} />
        </View>
        <Text style={styles.detail}>{insight.detail}</Text>
        <Text style={styles.actionLabel}>Recommended action</Text>
        <Text style={styles.action}>{insight.action}</Text>
      </View>
    </View>
  );
}

function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const label: Record<InsightSeverity, string> = {
    critical: 'Act now',
    warning: 'Watch',
    opportunity: 'Opportunity',
    positive: 'On pace',
  };
  return (
    <View style={[
      styles.badge,
      severity === 'critical' && styles.badgeCritical,
      severity === 'positive' && styles.badgePositive,
    ]}>
      <Text style={styles.badgeText}>{label[severity]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f3f6fb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9edf4' },
  backButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  sparkleBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf4ff' },
  flex: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: '#1769e0' },
  headerTitle: { fontSize: 22, fontWeight: '900', color: '#172033' },
  scroll: { padding: 18, paddingBottom: 70, gap: 14 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#172033', padding: 18, borderRadius: 20, shadowColor: '#172033', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  heroIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2f7df1' },
  heroTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  heroText: { color: '#cfd8e8', lineHeight: 19, marginTop: 3 },
  muted: { color: '#667085', lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#e6eaf0', gap: 9, shadowColor: '#172033', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  label: { fontSize: 12, fontWeight: '800', color: '#475467', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 },
  chipOn: { backgroundColor: '#eaf2ff', borderColor: '#1769e0' },
  chipText: { fontWeight: '700', color: '#475467' },
  chipTextOn: { color: '#1769e0' },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, minHeight: 108, backgroundColor: '#fff', padding: 15, borderRadius: 18, borderWidth: 1, borderColor: '#e6eaf0', justifyContent: 'center' },
  summaryCardPrimary: { backgroundColor: '#1769e0', borderColor: '#1769e0' },
  summaryLabel: { fontSize: 12, color: '#667085', fontWeight: '800' },
  summaryLabelPrimary: { fontSize: 12, color: '#dbe9ff', fontWeight: '800' },
  summaryValue: { fontSize: 23, fontWeight: '900', color: '#172033', marginTop: 6 },
  summaryValueSmall: { fontSize: 16, fontWeight: '900', color: '#172033', marginTop: 6 },
  summaryValuePrimary: { fontSize: 23, fontWeight: '900', color: '#fff', marginTop: 6 },
  noticeCard: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: '#fff8e8', padding: 13, borderRadius: 14, borderWidth: 1, borderColor: '#f3dfae' },
  noticeText: { flex: 1, color: '#6f4e00', lineHeight: 18, fontSize: 13, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#172033' },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eaf8ef', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  verifiedText: { color: '#18794e', fontSize: 11, fontWeight: '900' },
  insightCard: { flexDirection: 'row', gap: 12 },
  rank: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#172033', alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontWeight: '900' },
  insightTop: { gap: 7 },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#172033' },
  detail: { color: '#475467', lineHeight: 20 },
  actionLabel: { fontSize: 11, fontWeight: '900', color: '#1769e0', textTransform: 'uppercase', marginTop: 2, letterSpacing: 0.4 },
  action: { color: '#172033', lineHeight: 21, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#fff4e5' },
  badgeCritical: { backgroundColor: '#feeceb' },
  badgePositive: { backgroundColor: '#eaf8ef' },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#475467' },
  coachCard: { backgroundColor: '#fff', borderRadius: 20, padding: 17, borderWidth: 1, borderColor: '#cfe0ff', gap: 12, shadowColor: '#1769e0', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  coachHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1769e0' },
  coachSubtitle: { color: '#667085', fontSize: 12, marginTop: 2 },
  questionInput: { minHeight: 104, borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15, color: '#172033', backgroundColor: '#fbfcfe', textAlignVertical: 'top' },
  askButton: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1769e0', borderRadius: 14, paddingVertical: 14 },
  askButtonText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.55 },
  answerBox: { backgroundColor: '#f6f9ff', borderRadius: 15, padding: 15, gap: 9, borderWidth: 1, borderColor: '#dce8ff' },
  answerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  answerLabel: { fontSize: 11, fontWeight: '900', color: '#1769e0', letterSpacing: 0.9 },
  answerText: { color: '#172033', lineHeight: 22, fontSize: 15 },
  guardrailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  guardrail: { flex: 1, color: '#98a2b3', fontSize: 12, lineHeight: 17 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#b8cdf5', backgroundColor: '#fff' },
  secondaryText: { fontWeight: '800', color: '#1769e0' },
});
