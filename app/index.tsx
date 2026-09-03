import { Ionicons } from '@expo/vector-icons';
import type { Session, User } from '@supabase/supabase-js';
import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MetricCard } from '@/src/components/MetricCard';
import {
  addEmployee,
  getAssignment,
  getCustomKpis,
  getDailyForSellingDay,
  getDailyHistory,
  getDistrictStores,
  getEmployees,
  getHistoricalMonth,
  getLatestDaily,
  getMonthSettings,
  getStore,
  saveDaily,
  saveHistoricalMonth,
  saveMonthSettings,
} from '@/src/lib/appData';
import {
  calculatePerformance,
  costFromPercentage,
  formatCurrency,
  formatPercent,
  percentageFromCost,
} from '@/src/lib/performance';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import {
  canViewTeamWages,
  hasMinimumRole,
  ROLE_LABELS,
  sectionsForRole,
  type AppRole,
  type AppSection,
  type BootstrapWorkspaceInput,
  type CustomKpi,
  type DailyPerformance,
  type Employee,
  type HistoricalMonth,
  type MonthSettings,
  type PayType,
  type Store,
  type UserAssignment,
} from '@/src/types/app';
import type { PerformanceInput } from '@/src/types/performance';

interface StoreData {
  store: Store;
  settings: MonthSettings | null;
  daily: DailyPerformance | null;
  priorYear: HistoricalMonth | null;
  sameDayLastYear: DailyPerformance | null;
  kpis: CustomKpi[];
}

type ValueMode = 'cost' | 'percentage';

const today = () => new Date();
const yearMonth = () => ({ year: today().getFullYear(), month: today().getMonth() + 1 });
const isoDate = () => today().toISOString().slice(0, 10);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function performanceInput(data: StoreData): PerformanceInput {
  return {
    monthlySalesGoal: Number(data.settings?.sales_goal ?? 0),
    mtdSales: Number(data.daily?.mtd_sales ?? 0),
    laborCost: Number(data.daily?.labor_cost ?? 0),
    partsCost: Number(data.daily?.parts_cost ?? 0),
    carCount: Number(data.daily?.car_count_mtd ?? 0),
    sellingDaysCompleted: Number(data.daily?.selling_day_number ?? 0),
    totalSellingDays: Number(data.settings?.selling_days_total ?? 0),
    lastYearCompletedMonthSales: data.priorYear ? Number(data.priorYear.sales) : undefined,
    lastYearSameSellingDaySales: data.sameDayLastYear
      ? Number(data.sameDayLastYear.mtd_sales)
      : undefined,
  };
}

async function loadStoreData(store: Store): Promise<StoreData> {
  const { year, month } = yearMonth();
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

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <LoadingScreen />;
  if (!isSupabaseConfigured || !supabase) return <ConfigurationScreen />;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp user={session.user} />;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [assignment, setAssignment] = useState<UserAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAssignment(await getAssignment(user.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => void reload(), [reload]);
  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} onRetry={() => void reload()} />;
  if (!assignment) return <BootstrapScreen user={user} onComplete={reload} />;
  return <ApplicationShell assignment={assignment} />;
}

function LoadingScreen() {
  return <SafeAreaView style={styles.centered}><ActivityIndicator size="large" color="#1769e0" /></SafeAreaView>;
}

function ConfigurationScreen() {
  return (
    <SafeAreaView style={styles.centered}>
      <View style={styles.card}>
        <Ionicons name="shield-checkmark-outline" size={36} color="#1769e0" />
        <Text style={styles.title}>Connect Supabase</Text>
        <Text style={styles.muted}>Copy .env.example to .env and provide the project URL and publishable key.</Text>
      </View>
    </SafeAreaView>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.centered}>
      <View style={styles.card}><Text style={styles.title}>Could not load the workspace</Text><Text style={styles.error}>{message}</Text><Button label="Try again" onPress={onRetry} /></View>
    </SafeAreaView>
  );
}

function AuthScreen() {
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    if (!supabase || !email.trim() || password.length < 6) {
      setMessage('Enter an email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    const result = create
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    setMessage(result.error?.message ?? (create && !result.data.session ? 'Confirm your email, then sign in.' : ''));
  }
  return (
    <SafeAreaView style={styles.authPage}>
      <KeyboardAvoidingView style={styles.authInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Ionicons name="trending-up" size={42} color="#72a7ff" />
        <Text style={styles.authTitle}>Shop Profit Autopilot</Text>
        <View style={styles.authCard}>
          <Text style={styles.sectionTitle}>{create ? 'Create account' : 'Welcome back'}</Text>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {message ? <Text style={styles.error}>{message}</Text> : null}
          <Button label={create ? 'Create account' : 'Sign in'} onPress={() => void submit()} disabled={busy} />
          <Pressable onPress={() => setCreate(!create)}><Text style={styles.link}>{create ? 'Already registered? Sign in' : 'Create an account'}</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BootstrapScreen({ user, onComplete }: { user: User; onComplete: () => Promise<void> }) {
  const [form, setForm] = useState<BootstrapWorkspaceInput>({ companyName: '', districtName: '', storeName: '', fullName: '' });
  const [busy, setBusy] = useState(false);
  async function bootstrap() {
    if (!supabase || Object.values(form).some((value) => !value.trim())) {
      Alert.alert('Complete setup', 'All workspace fields are required.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke('bootstrap-workspace', {
      body: {
        company_name: form.companyName.trim(),
        district_name: form.districtName.trim(),
        store_name: form.storeName.trim(),
        full_name: form.fullName.trim(),
      },
    });
    setBusy(false);
    if (error) Alert.alert('Workspace setup failed', error.message);
    else await onComplete();
  }
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>SECURE WORKSPACE SETUP</Text><Text style={styles.title}>Create the first workspace</Text>
        <Text style={styles.muted}>No active assignment was found for {user.email}. The secure bootstrap-workspace Edge Function will create the initial records.</Text>
        <Field label="Company name" value={form.companyName} onChangeText={(companyName) => setForm({ ...form, companyName })} />
        <Field label="District name" value={form.districtName} onChangeText={(districtName) => setForm({ ...form, districtName })} />
        <Field label="Store name" value={form.storeName} onChangeText={(storeName) => setForm({ ...form, storeName })} />
        <Field label="Full name" value={form.fullName} onChangeText={(fullName) => setForm({ ...form, fullName })} />
        <Button label="Create workspace" onPress={() => void bootstrap()} disabled={busy} />
        <Pressable onPress={() => void supabase?.auth.signOut()}><Text style={styles.link}>Sign out</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ApplicationShell({ assignment }: { assignment: UserAssignment }) {
  const [section, setSection] = useState<AppSection>('home');
  const sections = sectionsForRole(assignment.role);
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><View><Text style={styles.headerBrand}>SHOP PROFIT AUTOPILOT</Text><Text style={styles.muted}>{ROLE_LABELS[assignment.role]}</Text></View><Pressable onPress={() => void supabase?.auth.signOut()}><Ionicons name="log-out-outline" size={25} color="#26364d" /></Pressable></View>
      <View style={styles.content}>
        {section === 'home' ? <Home assignment={assignment} /> : null}
        {section === 'numbers' ? <Numbers assignment={assignment} /> : null}
        {section === 'history' ? <History assignment={assignment} /> : null}
        {section === 'team' ? <Team assignment={assignment} /> : null}
      </View>
      <View style={styles.nav}>{sections.map((item) => <Pressable key={item} style={styles.navItem} onPress={() => setSection(item)}><Ionicons name={navIcon(item, section === item)} size={22} color={section === item ? '#1769e0' : '#788496'} /><Text style={[styles.navText, section === item && styles.active]}>{item}</Text></Pressable>)}</View>
    </SafeAreaView>
  );
}

function navIcon(section: AppSection, active: boolean) {
  return ({ home: active ? 'home' : 'home-outline', numbers: active ? 'calculator' : 'calculator-outline', history: active ? 'time' : 'time-outline', team: active ? 'people' : 'people-outline' } as const)[section];
}

function Home({ assignment }: { assignment: UserAssignment }) {
  const districtView = hasMinimumRole(assignment.role, 'district_manager') && Boolean(assignment.district_id);
  return districtView ? <DistrictHome assignment={assignment} /> : <StoreHome assignment={assignment} />;
}

function StoreHome({ assignment }: { assignment: UserAssignment }) {
  const [data, setData] = useState<StoreData | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!assignment.store_id) { setError('This assignment has no store scope.'); return; }
    setRefreshing(true); setError('');
    try { const store = await getStore(assignment.store_id); if (!store) throw new Error('The assigned store was not found or is inactive.'); setData(await loadStoreData(store)); }
    catch (caught) { setError(errorMessage(caught)); } finally { setRefreshing(false); }
  }, [assignment.store_id]);
  useEffect(() => void load(), [load]);
  if (!data && refreshing) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} onRetry={() => void load()} />;
  if (!data) return null;
  return <PerformanceDashboard title="Store Manager Home" data={data} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />} />;
}

function PerformanceDashboard({ title, data, refreshControl }: { title: string; data: StoreData; refreshControl?: ReactElement }) {
  const input = performanceInput(data);
  const metrics = calculatePerformance(input);
  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl}>
      <Text style={styles.eyebrow}>{title.toUpperCase()}</Text><Text style={styles.title}>{data.store.name}</Text>
      <View style={styles.grid}>
        <MetricCard label="Monthly goal" value={formatCurrency(input.monthlySalesGoal)} /><MetricCard label="MTD sales" value={formatCurrency(input.mtdSales)} accent="positive" />
        <MetricCard label="Selling days" value={`${input.sellingDaysCompleted} / ${input.totalSellingDays}`} /><MetricCard label="Projected month-end" value={formatCurrency(metrics.projectedMonthEnd)} detail="MTD ÷ completed × total days" />
        <MetricCard label="Projected goal" value={`${metrics.projectedGoalPercent.toFixed(1)}%`} /><MetricCard label="Remaining sales" value={formatCurrency(metrics.remainingSalesNeeded)} />
        <MetricCard label="Needed / remaining day" value={formatCurrency(metrics.salesNeededPerRemainingDay)} /><MetricCard label="Labor" value={`${metrics.laborPercent.toFixed(1)}%`} />
        <MetricCard label="Parts" value={`${metrics.partsPercent.toFixed(1)}%`} /><MetricCard label="ARO" value={formatCurrency(metrics.averageRepairOrder)} />
        <MetricCard label="Projected TY / LY" value={formatPercent(metrics.projectedYearOverYearPercent)} detail="Projected current vs completed LY" /><MetricCard label="Same-day TY / LY" value={formatPercent(metrics.sameDayYearOverYearPercent)} detail="MTD at equal selling-day count" />
      </View>
      <Card title="Custom KPIs">{data.kpis.length ? data.kpis.map((kpi) => <Text key={kpi.id} style={styles.rowText}>{kpi.name}: {formatKpi(kpi)}</Text>) : <Text style={styles.muted}>No active KPIs assigned.</Text>}</Card>
      <Card title="Top 3 Priorities"><Text style={styles.rowText}>1. Review today’s sales pace</Text><Text style={styles.rowText}>2. Coach the largest opportunity</Text><Text style={styles.rowText}>3. Confirm tomorrow’s staffing plan</Text></Card>
    </ScrollView>
  );
}

function formatKpi(kpi: CustomKpi): string {
  if (kpi.current_value === null) return 'Not entered';
  if (kpi.tracking_type === 'dollars') return formatCurrency(kpi.current_value);
  if (kpi.tracking_type === 'percentage') return `${kpi.current_value.toFixed(1)}%`;
  return String(kpi.current_value);
}

function DistrictHome({ assignment }: { assignment: UserAssignment }) {
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!assignment.district_id) return;
    setLoading(true); setError('');
    try { setStores(await Promise.all((await getDistrictStores(assignment.district_id)).map(loadStoreData))); }
    catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, [assignment.district_id]);
  useEffect(() => void load(), [load]);
  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} onRetry={() => void load()} />;
  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <Text style={styles.eyebrow}>DISTRICT MANAGER HOME</Text><Text style={styles.title}>Accessible stores</Text>
      {stores.map((data) => { const input = performanceInput(data); const metrics = calculatePerformance(input); return <View key={data.store.id} style={styles.storeRow}><View><Text style={styles.sectionTitle}>{data.store.name}</Text><Text style={styles.muted}>{formatCurrency(input.mtdSales)} MTD · Day {input.sellingDaysCompleted}/{input.totalSellingDays}</Text></View><View style={styles.alignRight}><Text style={styles.storeProjection}>{formatCurrency(metrics.projectedMonthEnd)}</Text><Text style={styles.muted}>{metrics.projectedGoalPercent.toFixed(1)}% of goal</Text></View></View>; })}
      {!stores.length ? <Text style={styles.muted}>No active stores are visible for this district.</Text> : null}
    </ScrollView>
  );
}

function Numbers({ assignment }: { assignment: UserAssignment }) {
  const [store, setStore] = useState<Store | null>(null);
  const [values, setValues] = useState({
    salesGoal: '',
    totalDays: '',
    laborGoalPct: '',
    partsGoalPct: '',
    mtdSales: '',
    labor: '',
    parts: '',
    cars: '',
    sellingDay: '',
  });
  const [laborMode, setLaborMode] = useState<ValueMode>('cost');
  const [partsMode, setPartsMode] = useState<ValueMode>('cost');
  const [busy, setBusy] = useState(false);
  const canEditGoals = hasMinimumRole(assignment.role, 'store_manager');
  useEffect(() => {
    if (!assignment.store_id) return;
    const { year, month } = yearMonth();
    void Promise.all([
      getStore(assignment.store_id),
      getMonthSettings(assignment.store_id, year, month),
      getLatestDaily(assignment.store_id, year, month),
    ])
      .then(([nextStore, settings, daily]) => {
        setStore(nextStore);
        setValues({
          salesGoal: settings?.sales_goal?.toString() ?? '',
          totalDays: settings?.selling_days_total?.toString() ?? '',
          laborGoalPct: settings?.labor_goal_pct?.toString() ?? '',
          partsGoalPct: settings?.parts_goal_pct?.toString() ?? '',
          mtdSales: daily?.mtd_sales?.toString() ?? '',
          labor: daily?.labor_cost?.toString() ?? '',
          parts: daily?.parts_cost?.toString() ?? '',
          cars: daily?.car_count_mtd?.toString() ?? '',
          sellingDay: daily?.selling_day_number?.toString() ?? '',
        });
      })
      .catch((error) => Alert.alert('Numbers error', errorMessage(error)));
  }, [assignment.store_id]);
  function number(value: string) { return Math.max(0, Number(value.replace(/[$,]/g, '')) || 0); }
  async function save() {
    if (!store) { Alert.alert('Store required', 'This assignment does not include a store.'); return; }
    const { year, month } = yearMonth();
    if (number(values.sellingDay) > number(values.totalDays)) { Alert.alert('Check selling days', 'Completed selling days cannot exceed total selling days.'); return; }
    const mtdSales = number(values.mtdSales);
    const laborCost = laborMode === 'percentage'
      ? costFromPercentage(mtdSales, number(values.labor))
      : number(values.labor);
    const partsCost = partsMode === 'percentage'
      ? costFromPercentage(mtdSales, number(values.parts))
      : number(values.parts);
    setBusy(true);
    try {
      const writes: Array<Promise<unknown>> = [
        saveDaily({
          store_id: store.id,
          business_date: isoDate(),
          selling_day_number: number(values.sellingDay),
          mtd_sales: mtdSales,
          labor_cost: laborCost,
          parts_cost: partsCost,
          car_count_mtd: number(values.cars),
        }),
      ];
      if (canEditGoals) {
        writes.push(saveMonthSettings({
          store_id: store.id,
          year,
          month,
          selling_days_total: number(values.totalDays),
          sales_goal: number(values.salesGoal),
          labor_goal_pct: values.laborGoalPct ? number(values.laborGoalPct) : null,
          parts_goal_pct: values.partsGoalPct ? number(values.partsGoalPct) : null,
        }));
      }
      await Promise.all(writes);
      Alert.alert('Saved', 'Supabase performance records were updated.');
    } catch (caught) { Alert.alert('Save failed', errorMessage(caught)); } finally { setBusy(false); }
  }
  const mtdSales = number(values.mtdSales);
  const laborPreview = laborMode === 'percentage'
    ? formatCurrency(costFromPercentage(mtdSales, number(values.labor)))
    : `${percentageFromCost(number(values.labor), mtdSales).toFixed(1)}%`;
  const partsPreview = partsMode === 'percentage'
    ? formatCurrency(costFromPercentage(mtdSales, number(values.parts)))
    : `${percentageFromCost(number(values.parts), mtdSales).toFixed(1)}%`;
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><Text style={styles.eyebrow}>NUMBERS</Text><Text style={styles.title}>{store?.name ?? 'No store assigned'}</Text>
      {canEditGoals ? <Card title="Monthly settings">
        <Field label="Monthly sales goal" value={values.salesGoal} onChangeText={(salesGoal) => setValues({ ...values, salesGoal })} keyboardType="decimal-pad" />
        <Field label="Total selling days" value={values.totalDays} onChangeText={(totalDays) => setValues({ ...values, totalDays })} keyboardType="decimal-pad" />
        <Field label="Labor goal %" value={values.laborGoalPct} onChangeText={(laborGoalPct) => setValues({ ...values, laborGoalPct })} keyboardType="decimal-pad" />
        <Field label="Parts goal %" value={values.partsGoalPct} onChangeText={(partsGoalPct) => setValues({ ...values, partsGoalPct })} keyboardType="decimal-pad" />
      </Card> : <Card title="Monthly settings"><Text style={styles.muted}>Goal editing requires Store Manager access. Current goal: {formatCurrency(number(values.salesGoal))}; selling days: {number(values.totalDays)}.</Text></Card>}
      <Field label="MTD sales" value={values.mtdSales} onChangeText={(mtdSales) => setValues({ ...values, mtdSales })} keyboardType="decimal-pad" />
      <MoneyPercentField label="Labor" value={values.labor} mode={laborMode} onModeChange={setLaborMode} onChangeText={(labor) => setValues({ ...values, labor })} preview={laborPreview} />
      <MoneyPercentField label="Parts" value={values.parts} mode={partsMode} onModeChange={setPartsMode} onChangeText={(parts) => setValues({ ...values, parts })} preview={partsPreview} />
      <Field label="Car count MTD" value={values.cars} onChangeText={(cars) => setValues({ ...values, cars })} keyboardType="decimal-pad" />
      <Field label="Selling-day number" value={values.sellingDay} onChangeText={(sellingDay) => setValues({ ...values, sellingDay })} keyboardType="decimal-pad" />
      <Button label="Save to Supabase" onPress={() => void save()} disabled={busy || !store} />
    </ScrollView>
  );
}

function History({ assignment }: { assignment: UserAssignment }) {
  const [rows, setRows] = useState<DailyPerformance[]>([]);
  const current = yearMonth();
  const [form, setForm] = useState({
    year: String(current.year - 1),
    month: String(current.month),
    sellingDays: '',
    sales: '',
    labor: '',
    parts: '',
    cars: '',
  });
  const [laborMode, setLaborMode] = useState<ValueMode>('cost');
  const [partsMode, setPartsMode] = useState<ValueMode>('cost');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function number(value: string) { return Math.max(0, Number(value.replace(/[$,]/g, '')) || 0); }
  useEffect(() => {
    if (!assignment.store_id) return;
    void Promise.all([
      getDailyHistory(assignment.store_id),
      getHistoricalMonth(assignment.store_id, current.year - 1, current.month),
    ]).then(([dailyRows, historical]) => {
      setRows(dailyRows);
      if (historical) setForm({
        year: String(historical.year),
        month: String(historical.month),
        sellingDays: historical.selling_days_total?.toString() ?? '',
        sales: historical.sales.toString(),
        labor: historical.labor_cost?.toString() ?? '',
        parts: historical.parts_cost?.toString() ?? '',
        cars: historical.car_count?.toString() ?? '',
      });
    }).catch((caught) => setError(errorMessage(caught)));
  }, [assignment.store_id, current.month, current.year]);
  async function saveHistory() {
    if (!assignment.store_id) return;
    const sales = number(form.sales);
    setBusy(true);
    try {
      await saveHistoricalMonth({
        store_id: assignment.store_id,
        year: number(form.year),
        month: Math.min(12, Math.max(1, number(form.month))),
        selling_days_total: form.sellingDays ? number(form.sellingDays) : null,
        sales,
        labor_cost: form.labor ? (laborMode === 'percentage' ? costFromPercentage(sales, number(form.labor)) : number(form.labor)) : null,
        parts_cost: form.parts ? (partsMode === 'percentage' ? costFromPercentage(sales, number(form.parts)) : number(form.parts)) : null,
        car_count: form.cars ? number(form.cars) : null,
      });
      Alert.alert('History saved', 'The historical month was saved to Supabase.');
    } catch (caught) { Alert.alert('History save failed', errorMessage(caught)); } finally { setBusy(false); }
  }
  const sales = number(form.sales);
  return <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><Text style={styles.eyebrow}>HISTORY</Text><Text style={styles.title}>Historical month entry</Text>
    <Card title="Completed month"><Field label="Year" value={form.year} onChangeText={(year) => setForm({ ...form, year })} keyboardType="number-pad" /><Field label="Month (1–12)" value={form.month} onChangeText={(month) => setForm({ ...form, month })} keyboardType="number-pad" /><Field label="Completed sales" value={form.sales} onChangeText={(salesValue) => setForm({ ...form, sales: salesValue })} keyboardType="decimal-pad" /><Field label="Selling days total" value={form.sellingDays} onChangeText={(sellingDays) => setForm({ ...form, sellingDays })} keyboardType="number-pad" />
      <MoneyPercentField label="Labor" value={form.labor} mode={laborMode} onModeChange={setLaborMode} onChangeText={(labor) => setForm({ ...form, labor })} preview={laborMode === 'percentage' ? formatCurrency(costFromPercentage(sales, number(form.labor))) : `${percentageFromCost(number(form.labor), sales).toFixed(1)}%`} />
      <MoneyPercentField label="Parts" value={form.parts} mode={partsMode} onModeChange={setPartsMode} onChangeText={(parts) => setForm({ ...form, parts })} preview={partsMode === 'percentage' ? formatCurrency(costFromPercentage(sales, number(form.parts))) : `${percentageFromCost(number(form.parts), sales).toFixed(1)}%`} />
      <Field label="Car count" value={form.cars} onChangeText={(cars) => setForm({ ...form, cars })} keyboardType="number-pad" /><Button label="Save historical month" onPress={() => void saveHistory()} disabled={busy} /></Card>
    <Text style={styles.sectionTitle}>Daily check-in history</Text>{error ? <Text style={styles.error}>{error}</Text> : null}{rows.map((row) => <View key={row.id} style={styles.storeRow}><View><Text style={styles.sectionTitle}>{row.business_date}</Text><Text style={styles.muted}>Selling day {row.selling_day_number}</Text></View><Text style={styles.storeProjection}>{formatCurrency(Number(row.mtd_sales))}</Text></View>)}{!rows.length && !error ? <Text style={styles.muted}>No daily entries are visible for this store.</Text> : null}</ScrollView>;
}

function Team({ assignment }: { assignment: UserAssignment }) {
  const allowed = canViewTeamWages(assignment.role);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({ name: '', title: '', payType: 'straight_hourly' as PayType, rate: '' });
  const load = useCallback(async () => { if (allowed && assignment.store_id) setEmployees(await getEmployees(assignment.store_id)); }, [allowed, assignment.store_id]);
  useEffect(() => { void load().catch((error) => Alert.alert('Team error', errorMessage(error))); }, [load]);
  if (!allowed) return <ErrorScreen message="Team wage information requires Store Manager access or above." onRetry={() => undefined} />;
  async function add() {
    if (!assignment.store_id || !form.name.trim()) return;
    try { await addEmployee({ store_id: assignment.store_id, employee_name: form.name.trim(), position_title: form.title.trim() || null, pay_type: form.payType, pay_rate: Math.max(0, Number(form.rate) || 0) }); setForm({ name: '', title: '', payType: 'straight_hourly', rate: '' }); await load(); }
    catch (caught) { Alert.alert('Employee could not be added', errorMessage(caught)); }
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><Text style={styles.eyebrow}>TEAM</Text><Text style={styles.title}>Employees and wages</Text>
      {employees.map((employee) => <View key={employee.id} style={styles.storeRow}><View><Text style={styles.sectionTitle}>{employee.employee_name}</Text><Text style={styles.muted}>{employee.position_title ?? employee.pay_type}</Text></View><Text style={styles.storeProjection}>{formatCurrency(Number(employee.pay_rate))}</Text></View>)}
      <Card title="Add employee"><Field label="Employee name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} /><Field label="Position title" value={form.title} onChangeText={(title) => setForm({ ...form, title })} /><Text style={styles.fieldLabel}>Pay type</Text><View style={styles.choiceRow}>{(['straight_hourly','flat_rate','salary'] as PayType[]).map((payType) => <Pressable key={payType} style={[styles.choice, form.payType === payType && styles.choiceActive]} onPress={() => setForm({ ...form, payType })}><Text>{payType.replace('_',' ')}</Text></Pressable>)}</View><Field label="Pay rate" value={form.rate} onChangeText={(rate) => setForm({ ...form, rate })} keyboardType="decimal-pad" /><Button label="Add employee" onPress={() => void add()} /></Card>
    </ScrollView>
  );
}

function MoneyPercentField({
  label,
  value,
  mode,
  onModeChange,
  onChangeText,
  preview,
}: {
  label: string;
  value: string;
  mode: ValueMode;
  onModeChange: (mode: ValueMode) => void;
  onChangeText: (value: string) => void;
  preview: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeading}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.modeToggle}>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeChoice, mode === 'cost' && styles.modeChoiceActive]}
            onPress={() => onModeChange('cost')}
          >
            <Text style={mode === 'cost' ? styles.modeTextActive : styles.modeText}>Cost $</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.modeChoice, mode === 'percentage' && styles.modeChoiceActive]}
            onPress={() => onModeChange('percentage')}
          >
            <Text style={mode === 'percentage' ? styles.modeTextActive : styles.modeText}>Percentage %</Text>
          </Pressable>
        </View>
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder={mode === 'cost' ? '0.00' : '0.0'}
        placeholderTextColor="#98a2b3"
      />
      <Text style={styles.inputPreview}>
        {mode === 'cost' ? 'Calculated percentage' : 'Calculated cost'}: {preview}
      </Text>
    </View>
  );
}

function Field({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} placeholderTextColor="#98a2b3" {...props} /></View>; }
function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable style={[styles.button, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={styles.buttonText}>{disabled ? 'Please wait…' : label}</Text></Pressable>; }
function Card({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.card}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f5f7fa'}, centered:{flex:1,alignItems:'center',justifyContent:'center',padding:24,backgroundColor:'#f5f7fa'}, content:{flex:1}, scroll:{padding:20,paddingBottom:36,gap:14}, formPage:{width:'100%',maxWidth:620,alignSelf:'center',padding:24,gap:15},
  authPage:{flex:1,backgroundColor:'#102a52'},authInner:{flex:1,justifyContent:'center',alignItems:'center',padding:24,gap:14},authTitle:{color:'#fff',fontSize:29,fontWeight:'900'},authCard:{width:'100%',maxWidth:460,padding:22,borderRadius:18,backgroundColor:'#fff',gap:14},
  header:{minHeight:66,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#e3e8ef'},headerBrand:{color:'#14213d',fontSize:12,fontWeight:'900',letterSpacing:.8},
  eyebrow:{color:'#1769e0',fontSize:12,fontWeight:'900',letterSpacing:1.1},title:{color:'#14213d',fontSize:27,fontWeight:'900'},sectionTitle:{color:'#14213d',fontSize:17,fontWeight:'800'},muted:{color:'#637083',fontSize:14,lineHeight:20},error:{color:'#a43e3e',lineHeight:20},link:{color:'#1769e0',fontWeight:'700',textAlign:'center',padding:6},
  field:{gap:6},fieldLabel:{color:'#34445c',fontSize:13,fontWeight:'700'},input:{minHeight:49,paddingHorizontal:14,borderWidth:1,borderColor:'#ccd5e0',borderRadius:11,backgroundColor:'#fff',color:'#14213d',fontSize:16},button:{minHeight:49,alignItems:'center',justifyContent:'center',borderRadius:11,backgroundColor:'#1769e0'},disabled:{opacity:.5},buttonText:{color:'#fff',fontWeight:'800'},
  fieldHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},modeToggle:{flexDirection:'row',padding:2,borderRadius:9,backgroundColor:'#edf1f6'},modeChoice:{paddingHorizontal:9,paddingVertical:6,borderRadius:7},modeChoiceActive:{backgroundColor:'#1769e0'},modeText:{color:'#637083',fontSize:11,fontWeight:'700'},modeTextActive:{color:'#fff',fontSize:11,fontWeight:'800'},inputPreview:{color:'#637083',fontSize:12},
  card:{padding:18,borderRadius:16,backgroundColor:'#fff',gap:12},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:12},rowText:{color:'#34445c',lineHeight:21},storeRow:{padding:16,borderRadius:14,backgroundColor:'#fff',flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},alignRight:{alignItems:'flex-end'},storeProjection:{color:'#1769e0',fontSize:18,fontWeight:'900'},
  nav:{minHeight:64,flexDirection:'row',borderTopWidth:1,borderTopColor:'#dce3eb',backgroundColor:'#fff'},navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:3},navText:{color:'#788496',fontSize:11,textTransform:'capitalize'},active:{color:'#1769e0',fontWeight:'800'},choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:7},choice:{padding:9,borderRadius:9,backgroundColor:'#edf1f6'},choiceActive:{backgroundColor:'#bcd5ff'},
});
