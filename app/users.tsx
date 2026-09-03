import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/src/lib/supabase';
import { hasMinimumRole, isAppRole, ROLE_LABELS, type AppRole } from '@/src/types/app';

type Store = { id: string; district_id: string; name: string; store_code: string | null };
type District = { id: string; name: string };
type Assignment = {
  id: string;
  user_id: string;
  organization_id: string;
  district_id: string | null;
  store_id: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
};
type Profile = { user_id: string; full_name: string | null };

type InviteForm = { email: string; fullName: string; role: AppRole; districtId: string; storeId: string };
const initialForm: InviteForm = { email: '', fullName: '', role: 'store_manager', districtId: '', storeId: '' };

function db() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong.'; }

export default function UsersScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [callerRole, setCallerRole] = useState<AppRole | null>(null);
  const [callerDistrictId, setCallerDistrictId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AppRole>('store_manager');
  const [editDistrictId, setEditDistrictId] = useState('');
  const [editStoreId, setEditStoreId] = useState('');

  const canManage = callerRole ? hasMinimumRole(callerRole, 'district_manager') : false;
  const allowedRoles = useMemo<AppRole[]>(() => {
    if (callerRole === 'district_manager') return ['assistant_manager', 'store_manager'];
    if (callerRole === 'regional') return ['assistant_manager', 'store_manager', 'district_manager'];
    if (callerRole === 'owner') return ['assistant_manager', 'store_manager', 'district_manager', 'regional', 'owner'];
    if (callerRole === 'admin') return ['assistant_manager', 'store_manager', 'district_manager', 'regional', 'owner', 'admin'];
    return [];
  }, [callerRole]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth, error: authError } = await db().auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error('Sign in is required.');
      const { data: caller, error: callerError } = await db().from('user_assignments')
        .select('organization_id,district_id,role')
        .eq('user_id', auth.user.id).eq('active', true).order('created_at', { ascending: true }).limit(1).single();
      if (callerError) throw callerError;
      if (!isAppRole(caller.role)) throw new Error('Unsupported role.');
      setCallerRole(caller.role); setCallerDistrictId(caller.district_id); setOrganizationId(caller.organization_id);
      if (!hasMinimumRole(caller.role, 'district_manager')) return;

      let districtQuery = db().from('districts').select('id,name').eq('organization_id', caller.organization_id).order('name');
      let storeQuery = db().from('stores').select('id,district_id,name,store_code').eq('organization_id', caller.organization_id).eq('active', true).order('name');
      let assignmentQuery = db().from('user_assignments').select('id,user_id,organization_id,district_id,store_id,role,active,created_at').eq('organization_id', caller.organization_id).order('created_at');
      if (caller.role === 'district_manager' && caller.district_id) {
        districtQuery = districtQuery.eq('id', caller.district_id);
        storeQuery = storeQuery.eq('district_id', caller.district_id);
        assignmentQuery = assignmentQuery.eq('district_id', caller.district_id);
      }
      const [{ data: districtRows, error: districtError }, { data: storeRows, error: storeError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([districtQuery, storeQuery, assignmentQuery]);
      if (districtError) throw districtError; if (storeError) throw storeError; if (assignmentError) throw assignmentError;
      const nextAssignments = (assignmentRows ?? []).filter((row) => isAppRole(row.role)) as Assignment[];
      setDistricts((districtRows ?? []) as District[]); setStores((storeRows ?? []) as Store[]); setAssignments(nextAssignments);
      if (nextAssignments.length) {
        const { data: profileRows, error: profileError } = await db().from('profiles').select('user_id,full_name').in('user_id', nextAssignments.map((row) => row.user_id));
        if (profileError) throw profileError;
        setProfiles((profileRows ?? []) as Profile[]);
      } else setProfiles([]);
      setForm((current) => ({ ...current, districtId: caller.role === 'district_manager' ? caller.district_id ?? '' : current.districtId }));
    } catch (error) { Alert.alert('Users', message(error)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => void load(), [load]);

  const storesForInvite = stores.filter((store) => !form.districtId || store.district_id === form.districtId);
  const storesForEdit = stores.filter((store) => !editDistrictId || store.district_id === editDistrictId);

  function roleNeedsStore(role: AppRole) { return role === 'assistant_manager' || role === 'store_manager'; }
  function roleNeedsDistrict(role: AppRole) { return role === 'district_manager' || roleNeedsStore(role); }

  async function invite() {
    if (!form.email.trim()) return Alert.alert('Email required', 'Enter the person’s email address.');
    if (roleNeedsDistrict(form.role) && !form.districtId && callerRole !== 'district_manager') return Alert.alert('District required', 'Choose a district for this role.');
    if (roleNeedsStore(form.role) && !form.storeId) return Alert.alert('Store required', 'Choose a store for this role.');
    setSaving(true);
    try {
      const { data, error } = await db().functions.invoke('invite-user', { body: { email: form.email.trim(), full_name: form.fullName.trim() || null, role: form.role, district_id: callerRole === 'district_manager' ? callerDistrictId : form.districtId || null, store_id: form.storeId || null } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Alert.alert('User added', data?.invitation_sent ? 'Invitation email sent and the role was assigned.' : 'This existing account was assigned to the workspace.');
      setForm({ ...initialForm, role: allowedRoles[0] ?? 'store_manager', districtId: callerRole === 'district_manager' ? callerDistrictId ?? '' : '' });
      await load();
    } catch (error) { Alert.alert('Could not add user', message(error)); }
    finally { setSaving(false); }
  }

  function beginEdit(row: Assignment) {
    setEditingId(row.id); setEditRole(row.role); setEditDistrictId(row.district_id ?? ''); setEditStoreId(row.store_id ?? '');
  }

  async function saveEdit(active?: boolean) {
    if (!editingId) return;
    if (roleNeedsStore(editRole) && !editStoreId) return Alert.alert('Store required', 'Choose a store for this role.');
    setSaving(true);
    try {
      const { data, error } = await db().functions.invoke('manage-user-assignment', { body: { assignment_id: editingId, role: editRole, district_id: roleNeedsDistrict(editRole) ? (callerRole === 'district_manager' ? callerDistrictId : editDistrictId || null) : null, store_id: roleNeedsStore(editRole) ? editStoreId : null, ...(active === undefined ? {} : { active }) } });
      if (error) throw error; if (data?.error) throw new Error(data.error);
      setEditingId(null); await load();
    } catch (error) { Alert.alert('Could not update user', message(error)); }
    finally { setSaving(false); }
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!canManage) return <SafeAreaView style={styles.center}><Ionicons name="lock-closed-outline" size={40} /><Text style={styles.title}>District Manager access required</Text><Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>Go back</Text></Pressable></SafeAreaView>;

  return <SafeAreaView style={styles.page}>
    <View style={styles.header}><Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={28} /></Pressable><View><Text style={styles.eyebrow}>DISTRICT TOOLS</Text><Text style={styles.headerTitle}>Users & Roles</Text></View></View>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.help}>Invite managers and assistants, assign their role and store scope, or deactivate access. Sensitive changes run through secure server functions rather than direct client writes.</Text>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Invite user</Text>
        <Label text="Email" /><TextInput style={styles.input} value={form.email} onChangeText={(email) => setForm({ ...form, email })} autoCapitalize="none" keyboardType="email-address" placeholder="manager@company.com" />
        <Label text="Full name" /><TextInput style={styles.input} value={form.fullName} onChangeText={(fullName) => setForm({ ...form, fullName })} placeholder="Optional" />
        <Label text="Role" /><View style={styles.choiceRow}>{allowedRoles.map((role) => <Choice key={role} label={ROLE_LABELS[role]} active={form.role === role} onPress={() => setForm({ ...form, role, storeId: roleNeedsStore(role) ? form.storeId : '', districtId: callerRole === 'district_manager' ? callerDistrictId ?? '' : roleNeedsDistrict(role) ? form.districtId : '' })} />)}</View>
        {roleNeedsDistrict(form.role) && callerRole !== 'district_manager' ? <><Label text="District" /><View style={styles.choiceRow}>{districts.map((district) => <Choice key={district.id} label={district.name} active={form.districtId === district.id} onPress={() => setForm({ ...form, districtId: district.id, storeId: '' })} />)}</View></> : null}
        {roleNeedsStore(form.role) ? <><Label text="Store" /><View style={styles.storeList}>{storesForInvite.map((store) => <Pressable key={store.id} style={[styles.storeChoice, form.storeId === store.id && styles.storeChoiceActive]} onPress={() => setForm({ ...form, districtId: store.district_id, storeId: store.id })}><Ionicons name={form.storeId === store.id ? 'radio-button-on' : 'radio-button-off'} size={20} /><Text style={styles.storeText}>{store.store_code ? `${store.store_code} · ` : ''}{store.name}</Text></Pressable>)}</View></> : null}
        <Pressable style={[styles.button, saving && styles.disabled]} disabled={saving} onPress={() => void invite()}><Text style={styles.buttonText}>{saving ? 'Working…' : 'Send invite / assign user'}</Text></Pressable>
      </View>

      <Text style={styles.sectionTitle}>Current users</Text>
      {assignments.map((row) => {
        const name = profiles.find((profile) => profile.user_id === row.user_id)?.full_name ?? 'Invited user';
        const store = stores.find((item) => item.id === row.store_id)?.name;
        const district = districts.find((item) => item.id === row.district_id)?.name;
        const editing = editingId === row.id;
        return <View key={row.id} style={[styles.card, !row.active && styles.inactive]}>
          <View style={styles.userTop}><View style={styles.flex}><Text style={styles.userName}>{name}</Text><Text style={styles.meta}>{ROLE_LABELS[row.role]}{store ? ` · ${store}` : district ? ` · ${district}` : ''} · {row.active ? 'Active' : 'Inactive'}</Text></View><Pressable onPress={() => editing ? setEditingId(null) : beginEdit(row)}><Ionicons name={editing ? 'close' : 'create-outline'} size={24} /></Pressable></View>
          {editing ? <View style={styles.editBox}>
            <Label text="Role" /><View style={styles.choiceRow}>{allowedRoles.map((role) => <Choice key={role} label={ROLE_LABELS[role]} active={editRole === role} onPress={() => { setEditRole(role); if (!roleNeedsStore(role)) setEditStoreId(''); if (!roleNeedsDistrict(role)) setEditDistrictId(''); }} />)}</View>
            {roleNeedsDistrict(editRole) && callerRole !== 'district_manager' ? <><Label text="District" /><View style={styles.choiceRow}>{districts.map((item) => <Choice key={item.id} label={item.name} active={editDistrictId === item.id} onPress={() => { setEditDistrictId(item.id); setEditStoreId(''); }} />)}</View></> : null}
            {roleNeedsStore(editRole) ? <><Label text="Store" /><View style={styles.storeList}>{storesForEdit.map((item) => <Pressable key={item.id} style={[styles.storeChoice, editStoreId === item.id && styles.storeChoiceActive]} onPress={() => { setEditDistrictId(item.district_id); setEditStoreId(item.id); }}><Ionicons name={editStoreId === item.id ? 'radio-button-on' : 'radio-button-off'} size={20} /><Text style={styles.storeText}>{item.name}</Text></Pressable>)}</View></> : null}
            <View style={styles.actions}><Pressable style={styles.button} onPress={() => void saveEdit()}><Text style={styles.buttonText}>Save role</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => void saveEdit(!row.active)}><Text>{row.active ? 'Deactivate access' : 'Reactivate access'}</Text></Pressable></View>
          </View> : null}
        </View>;
      })}
      {!assignments.length ? <Text style={styles.help}>No users are currently visible in your scope.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

function Label({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text>; }
function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'#f5f7fb'},center:{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16},header:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:18,paddingVertical:12,backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#e6eaf0'},headerTitle:{fontSize:20,fontWeight:'800',color:'#172033'},eyebrow:{fontSize:11,fontWeight:'800',letterSpacing:1.2,color:'#1769e0'},scroll:{padding:18,paddingBottom:60,gap:14},title:{fontSize:22,fontWeight:'800',textAlign:'center'},help:{color:'#667085',lineHeight:20},card:{backgroundColor:'#fff',borderRadius:16,padding:16,gap:10,borderWidth:1,borderColor:'#e6eaf0'},sectionTitle:{fontSize:18,fontWeight:'800',color:'#172033'},label:{fontSize:13,fontWeight:'700',color:'#344054',marginTop:4},input:{borderWidth:1,borderColor:'#d0d5dd',borderRadius:10,paddingHorizontal:12,paddingVertical:11,backgroundColor:'#fff',fontSize:16},choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{paddingHorizontal:12,paddingVertical:9,borderRadius:10,borderWidth:1,borderColor:'#d0d5dd',backgroundColor:'#fff'},choiceActive:{backgroundColor:'#eaf2ff',borderColor:'#1769e0'},choiceText:{color:'#475467',fontWeight:'600'},choiceTextActive:{color:'#1769e0'},storeList:{gap:7},storeChoice:{flexDirection:'row',alignItems:'center',gap:9,padding:10,borderRadius:10,borderWidth:1,borderColor:'#e6eaf0'},storeChoiceActive:{backgroundColor:'#f0f6ff',borderColor:'#8ab8ff'},storeText:{flex:1,fontWeight:'600',color:'#344054'},button:{backgroundColor:'#1769e0',borderRadius:10,paddingHorizontal:16,paddingVertical:12,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800'},secondaryButton:{borderWidth:1,borderColor:'#d0d5dd',borderRadius:10,paddingHorizontal:14,paddingVertical:10,alignItems:'center'},disabled:{opacity:.55},inactive:{opacity:.55},userTop:{flexDirection:'row',alignItems:'flex-start',gap:10},flex:{flex:1},userName:{fontSize:17,fontWeight:'800',color:'#172033'},meta:{marginTop:4,color:'#667085',lineHeight:18},editBox:{gap:10,borderTopWidth:1,borderTopColor:'#eef1f5',paddingTop:10},actions:{flexDirection:'row',flexWrap:'wrap',gap:8}
});
