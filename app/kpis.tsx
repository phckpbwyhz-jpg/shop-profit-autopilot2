import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { supabase } from '@/src/lib/supabase';
import { hasMinimumRole, isAppRole, type AppRole, type KpiTrackingType } from '@/src/types/app';

type Direction = 'higher' | 'lower';
type Store = { id: string; name: string; store_code: string | null };
type Definition = {
  id: string;
  name: string;
  tracking_type: KpiTrackingType;
  default_monthly_goal: number | null;
  required: boolean;
  active: boolean;
  goal_direction: Direction;
};
type StoreAssignment = { kpi_id: string; store_id: string; monthly_goal: number | null; active: boolean };

type Form = {
  name: string;
  trackingType: KpiTrackingType;
  goal: string;
  direction: Direction;
  required: boolean;
};

const emptyForm: Form = { name: '', trackingType: 'dollars', goal: '', direction: 'higher', required: false };

function db() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function KpiBuilderScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [districtId, setDistrictId] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [assignments, setAssignments] = useState<StoreAssignment[]>([]);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canManage = role ? hasMinimumRole(role, 'district_manager') : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth, error: authError } = await db().auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error('Sign in is required.');
      const { data: assignment, error: assignmentError } = await db()
        .from('user_assignments')
        .select('organization_id,district_id,role')
        .eq('user_id', auth.user.id)
        .eq('active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      if (assignmentError) throw assignmentError;
      if (!isAppRole(assignment.role)) throw new Error('Unsupported role.');
      setRole(assignment.role);
      setOrganizationId(assignment.organization_id);
      setDistrictId(assignment.district_id);
      if (!hasMinimumRole(assignment.role, 'district_manager')) return;

      let storeQuery = db().from('stores').select('id,name,store_code').eq('organization_id', assignment.organization_id).eq('active', true).order('name');
      if (assignment.district_id && assignment.role === 'district_manager') storeQuery = storeQuery.eq('district_id', assignment.district_id);
      let definitionQuery = db().from('kpi_definitions').select('id,name,tracking_type,default_monthly_goal,required,active,goal_direction').eq('organization_id', assignment.organization_id).order('name');
      if (assignment.district_id && assignment.role === 'district_manager') definitionQuery = definitionQuery.eq('district_id', assignment.district_id);
      const [{ data: storeRows, error: storeError }, { data: definitionRows, error: definitionError }] = await Promise.all([storeQuery, definitionQuery]);
      if (storeError) throw storeError;
      if (definitionError) throw definitionError;
      setStores((storeRows ?? []) as Store[]);
      const defs = (definitionRows ?? []) as Definition[];
      setDefinitions(defs);
      if (defs.length) {
        const { data: assignmentRows, error } = await db().from('kpi_store_assignments').select('kpi_id,store_id,monthly_goal,active').in('kpi_id', defs.map((item) => item.id));
        if (error) throw error;
        setAssignments((assignmentRows ?? []) as StoreAssignment[]);
      } else setAssignments([]);
    } catch (error) {
      Alert.alert('KPI Builder', message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const editingAssignments = useMemo(() => editingId ? assignments.filter((item) => item.kpi_id === editingId && item.active).map((item) => item.store_id) : [], [assignments, editingId]);

  function toggleStore(storeId: string) {
    setSelectedStores((current) => current.includes(storeId) ? current.filter((id) => id !== storeId) : [...current, storeId]);
  }

  function beginEdit(definition: Definition) {
    setEditingId(definition.id);
    setForm({
      name: definition.name,
      trackingType: definition.tracking_type,
      goal: definition.default_monthly_goal?.toString() ?? '',
      direction: definition.goal_direction,
      required: definition.required,
    });
    setSelectedStores(assignments.filter((item) => item.kpi_id === definition.id && item.active).map((item) => item.store_id));
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedStores([]);
  }

  async function save() {
    if (!form.name.trim()) return Alert.alert('KPI name required', 'Give this KPI a name managers will recognize.');
    if (!selectedStores.length) return Alert.alert('Choose stores', 'Assign this KPI to at least one store.');
    const goal = form.goal.trim() ? Number(form.goal.replace(/[$,% ,]/g, '')) : null;
    if (goal !== null && (!Number.isFinite(goal) || goal < 0)) return Alert.alert('Check goal', 'Enter a valid goal of zero or greater.');
    setSaving(true);
    try {
      const user = (await db().auth.getUser()).data.user;
      if (!user) throw new Error('Sign in is required.');
      const definitionValues = {
        organization_id: organizationId,
        district_id: districtId,
        name: form.name.trim(),
        tracking_type: form.trackingType,
        default_monthly_goal: goal,
        required: form.required,
        active: true,
        goal_direction: form.direction,
      };
      let kpiId = editingId;
      if (editingId) {
        const { error } = await db().from('kpi_definitions').update(definitionValues).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await db().from('kpi_definitions').insert({ ...definitionValues, created_by: user.id }).select('id').single();
        if (error) throw error;
        kpiId = data.id;
      }
      if (!kpiId) throw new Error('KPI could not be created.');

      const existing = assignments.filter((item) => item.kpi_id === kpiId);
      await Promise.all(stores.map(async (store) => {
        const row = existing.find((item) => item.store_id === store.id);
        const active = selectedStores.includes(store.id);
        if (row) {
          const { error } = await db().from('kpi_store_assignments').update({ active, monthly_goal: goal }).eq('kpi_id', kpiId).eq('store_id', store.id);
          if (error) throw error;
        } else if (active) {
          const { error } = await db().from('kpi_store_assignments').insert({ kpi_id: kpiId, store_id: store.id, monthly_goal: goal, active: true });
          if (error) throw error;
        }
      }));
      reset();
      await load();
      Alert.alert('KPI saved', 'This KPI is now assigned to the selected stores and will flow into their KPI data.');
    } catch (error) {
      Alert.alert('Could not save KPI', message(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(definition: Definition) {
    try {
      const { error } = await db().from('kpi_definitions').update({ active: !definition.active }).eq('id', definition.id);
      if (error) throw error;
      await load();
    } catch (error) { Alert.alert('Could not update KPI', message(error)); }
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!canManage) return <SafeAreaView style={styles.center}><Ionicons name="lock-closed-outline" size={40} /><Text style={styles.title}>District Manager access required</Text><Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Go back</Text></Pressable></SafeAreaView>;

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={28} /></Pressable><View><Text style={styles.eyebrow}>DISTRICT TOOLS</Text><Text style={styles.headerTitle}>Custom KPI Builder</Text></View></View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>Create the metrics your company actually manages. Assigned KPIs automatically use the existing store KPI system.</Text>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{editingId ? 'Edit KPI' : 'Create KPI'}</Text>
          <Label text="KPI name" /><TextInput style={styles.input} value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Example: Alignment Dollars" />
          <Label text="Tracking type" /><View style={styles.choiceRow}>{(['dollars','percentage','units'] as KpiTrackingType[]).map((type) => <Choice key={type} label={type === 'dollars' ? 'Dollars ($)' : type === 'percentage' ? 'Percentage (%)' : 'Units'} active={form.trackingType === type} onPress={() => setForm({ ...form, trackingType: type })} />)}</View>
          <Label text="Monthly goal" /><TextInput style={styles.input} value={form.goal} onChangeText={(goal) => setForm({ ...form, goal })} keyboardType="decimal-pad" placeholder="Optional" />
          <Label text="Which direction is better?" /><View style={styles.choiceRow}><Choice label="Higher is better" active={form.direction === 'higher'} onPress={() => setForm({ ...form, direction: 'higher' })} /><Choice label="Lower is better" active={form.direction === 'lower'} onPress={() => setForm({ ...form, direction: 'lower' })} /></View>
          <Label text="Required?" /><Choice label={form.required ? 'Required' : 'Optional'} active={form.required} onPress={() => setForm({ ...form, required: !form.required })} />
          <Label text="Assign to stores" />
          <View style={styles.storeList}>{stores.map((store) => <Pressable key={store.id} style={[styles.storeChoice, selectedStores.includes(store.id) && styles.storeChoiceActive]} onPress={() => toggleStore(store.id)}><Ionicons name={selectedStores.includes(store.id) ? 'checkbox' : 'square-outline'} size={22} /><Text style={styles.storeText}>{store.store_code ? `${store.store_code} · ` : ''}{store.name}</Text></Pressable>)}</View>
          <View style={styles.actions}><Pressable style={[styles.button, saving && styles.disabled]} disabled={saving} onPress={() => void save()}><Text style={styles.buttonText}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create KPI'}</Text></Pressable>{editingId ? <Pressable style={styles.secondaryButton} onPress={reset}><Text>Cancel</Text></Pressable> : null}</View>
        </View>

        <Text style={styles.sectionTitle}>District KPIs</Text>
        {definitions.map((definition) => {
          const count = assignments.filter((item) => item.kpi_id === definition.id && item.active).length;
          return <View key={definition.id} style={[styles.card, !definition.active && styles.inactive]}><View style={styles.kpiTop}><View style={styles.flex}><Text style={styles.kpiName}>{definition.name}</Text><Text style={styles.meta}>{definition.tracking_type} · {definition.goal_direction} is better · {definition.required ? 'required' : 'optional'} · {count} store{count === 1 ? '' : 's'}</Text></View><Pressable onPress={() => beginEdit(definition)}><Ionicons name="create-outline" size={24} /></Pressable></View><View style={styles.actions}><Pressable style={styles.secondaryButton} onPress={() => beginEdit(definition)}><Text>Edit</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => void toggleActive(definition)}><Text>{definition.active ? 'Deactivate' : 'Reactivate'}</Text></Pressable></View></View>;
        })}
        {!definitions.length ? <Text style={styles.help}>No custom KPIs yet. Create the first one above.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Label({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text>; }
function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fb' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e6eaf0' }, headerTitle: { fontSize: 20, fontWeight: '800', color: '#172033' }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#1769e0' }, scroll: { padding: 18, paddingBottom: 60, gap: 14 }, title: { fontSize: 22, fontWeight: '800', textAlign: 'center' }, help: { color: '#667085', lineHeight: 20 }, card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: '#e6eaf0' }, sectionTitle: { fontSize: 18, fontWeight: '800', color: '#172033' }, label: { fontSize: 13, fontWeight: '700', color: '#344054', marginTop: 4 }, input: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#fff', fontSize: 16 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#d0d5dd', backgroundColor: '#fff' }, choiceActive: { backgroundColor: '#eaf2ff', borderColor: '#1769e0' }, choiceText: { color: '#475467', fontWeight: '600' }, choiceTextActive: { color: '#1769e0' }, storeList: { gap: 7 }, storeChoice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e6eaf0' }, storeChoiceActive: { backgroundColor: '#f0f6ff', borderColor: '#8ab8ff' }, storeText: { flex: 1, fontWeight: '600', color: '#344054' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }, button: { backgroundColor: '#1769e0', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '800' }, secondaryButton: { borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' }, disabled: { opacity: 0.55 }, inactive: { opacity: 0.55 }, kpiTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, flex: { flex: 1 }, kpiName: { fontSize: 17, fontWeight: '800', color: '#172033' }, meta: { marginTop: 4, color: '#667085', lineHeight: 18 },
});
