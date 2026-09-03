import { supabase } from '@/src/lib/supabase';
import { isAppRole } from '@/src/types/app';
import type {
  CustomKpi,
  DailyPerformance,
  Employee,
  HistoricalMonth,
  MonthSettings,
  PayType,
  Store,
  UserAssignment,
} from '@/src/types/app';

function client() {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  return supabase;
}

async function authenticatedUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('An authenticated user is required.');
  return data.user.id;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw error;
}

export async function getAssignment(userId: string): Promise<UserAssignment | null> {
  const { data, error } = await client()
    .from('user_assignments')
    .select('id,user_id,organization_id,district_id,store_id,role,active,created_at')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  if (!isAppRole(data.role)) throw new Error(`Unsupported assignment role: ${String(data.role)}`);
  return data as UserAssignment;
}

export async function getStore(storeId: string): Promise<Store | null> {
  const { data, error } = await client()
    .from('stores')
    .select('id,organization_id,district_id,store_code,name,active,created_at')
    .eq('id', storeId)
    .eq('active', true)
    .maybeSingle();
  throwIfError(error);
  return data as Store | null;
}

export async function getMonthSettings(
  storeId: string,
  year: number,
  month: number,
): Promise<MonthSettings | null> {
  const { data, error } = await client()
    .from('store_month_settings')
    .select('*')
    .eq('store_id', storeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  throwIfError(error);
  return data as MonthSettings | null;
}

export async function saveMonthSettings(
  values: Pick<MonthSettings, 'store_id' | 'year' | 'month' | 'selling_days_total' | 'sales_goal' | 'labor_goal_pct' | 'parts_goal_pct'>,
): Promise<MonthSettings> {
  const existing = await getMonthSettings(values.store_id, values.year, values.month);
  const query = existing
    ? client().from('store_month_settings').update(values).eq('id', existing.id)
    : client().from('store_month_settings').insert({
        ...values,
        created_by: await authenticatedUserId(),
      });
  const { data, error } = await query.select('*').single();
  throwIfError(error);
  return data as MonthSettings;
}

export async function getLatestDaily(
  storeId: string,
  year?: number,
  month?: number,
): Promise<DailyPerformance | null> {
  let query = client()
    .from('daily_performance')
    .select('*')
    .eq('store_id', storeId);
  if (year !== undefined && month !== undefined) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    query = query.gte('business_date', start).lt('business_date', end);
  }
  const { data, error } = await query
    .order('business_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data as DailyPerformance | null;
}

export async function getDailyForSellingDay(
  storeId: string,
  year: number,
  month: number,
  sellingDayNumber: number,
): Promise<DailyPerformance | null> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 1));
  const end = endDate.toISOString().slice(0, 10);
  const { data, error } = await client()
    .from('daily_performance')
    .select('*')
    .eq('store_id', storeId)
    .eq('selling_day_number', sellingDayNumber)
    .gte('business_date', start)
    .lt('business_date', end)
    .order('business_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data as DailyPerformance | null;
}

export async function saveDaily(
  values: Pick<DailyPerformance, 'store_id' | 'business_date' | 'selling_day_number' | 'mtd_sales' | 'labor_cost' | 'parts_cost' | 'car_count_mtd'>,
): Promise<DailyPerformance> {
  const userId = await authenticatedUserId();
  const { data: existing, error: findError } = await client()
    .from('daily_performance')
    .select('id')
    .eq('store_id', values.store_id)
    .eq('business_date', values.business_date)
    .maybeSingle();
  throwIfError(findError);
  const query = existing
    ? client().from('daily_performance').update({ ...values, updated_by: userId }).eq('id', existing.id)
    : client().from('daily_performance').insert({ ...values, entered_by: userId });
  const { data, error } = await query.select('*').single();
  throwIfError(error);
  return data as DailyPerformance;
}

export async function getHistoricalMonth(
  storeId: string,
  year: number,
  month: number,
): Promise<HistoricalMonth | null> {
  const { data, error } = await client()
    .from('historical_months')
    .select('*')
    .eq('store_id', storeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  throwIfError(error);
  return data as HistoricalMonth | null;
}

export async function saveHistoricalMonth(
  values: Pick<HistoricalMonth, 'store_id' | 'year' | 'month' | 'selling_days_total' | 'sales' | 'labor_cost' | 'parts_cost' | 'car_count'>,
): Promise<HistoricalMonth> {
  const existing = await getHistoricalMonth(values.store_id, values.year, values.month);
  const query = existing
    ? client().from('historical_months').update(values).eq('id', existing.id)
    : client().from('historical_months').insert({
        ...values,
        entered_by: await authenticatedUserId(),
      });
  const { data, error } = await query.select('*').single();
  throwIfError(error);
  return data as HistoricalMonth;
}

export async function getCustomKpis(
  storeId: string,
  year: number,
  month: number,
): Promise<CustomKpi[]> {
  const { data: assignments, error } = await client()
    .from('kpi_store_assignments')
    .select('kpi_id,monthly_goal,kpi_definitions!inner(id,name,tracking_type,required,active,goal_direction)')
    .eq('store_id', storeId)
    .eq('active', true)
    .eq('kpi_definitions.active', true);
  throwIfError(error);
  const rows = (assignments ?? []) as unknown as Array<{
    kpi_id: string;
    monthly_goal: number | null;
    kpi_definitions: {
      id: string;
      name: string;
      tracking_type: CustomKpi['tracking_type'];
      required: boolean;
      goal_direction: CustomKpi['goal_direction'];
    };
  }>;
  if (!rows.length) return [];
  const { data: values, error: valuesError } = await client()
    .from('kpi_month_values')
    .select('kpi_id,current_value')
    .eq('store_id', storeId)
    .eq('year', year)
    .eq('month', month)
    .in('kpi_id', rows.map((row) => row.kpi_id));
  throwIfError(valuesError);
  const current = new Map((values ?? []).map((value) => [value.kpi_id, Number(value.current_value)]));
  return rows.map((row) => ({
    id: row.kpi_id,
    name: row.kpi_definitions.name,
    tracking_type: row.kpi_definitions.tracking_type,
    goal_direction: row.kpi_definitions.goal_direction,
    required: row.kpi_definitions.required,
    monthly_goal: row.monthly_goal,
    current_value: current.get(row.kpi_id) ?? null,
  }));
}

export async function saveCustomKpiValues(
  storeId: string,
  year: number,
  month: number,
  values: Array<{ kpi_id: string; current_value: number }>,
): Promise<void> {
  if (!values.length) return;
  const userId = await authenticatedUserId();
  const ids = values.map((value) => value.kpi_id);
  const { data: existingRows, error: existingError } = await client()
    .from('kpi_month_values')
    .select('id,kpi_id')
    .eq('store_id', storeId)
    .eq('year', year)
    .eq('month', month)
    .in('kpi_id', ids);
  throwIfError(existingError);
  const existing = new Map((existingRows ?? []).map((row) => [row.kpi_id, row.id]));
  await Promise.all(values.map(async (value) => {
    const existingId = existing.get(value.kpi_id);
    const query = existingId
      ? client().from('kpi_month_values').update({ current_value: value.current_value, entered_by: userId }).eq('id', existingId)
      : client().from('kpi_month_values').insert({
          kpi_id: value.kpi_id,
          store_id: storeId,
          year,
          month,
          current_value: value.current_value,
          entered_by: userId,
        });
    const { error } = await query;
    throwIfError(error);
  }));
}

export async function getEmployees(storeId: string): Promise<Employee[]> {
  const { data, error } = await client()
    .from('employees')
    .select('*')
    .eq('store_id', storeId)
    .eq('active', true)
    .order('employee_name');
  throwIfError(error);
  return (data ?? []) as Employee[];
}

export async function addEmployee(values: {
  store_id: string;
  employee_name: string;
  position_title: string | null;
  pay_type: PayType;
  pay_rate: number;
}): Promise<Employee> {
  const { data, error } = await client()
    .from('employees')
    .insert({ ...values, active: true, created_by: await authenticatedUserId() })
    .select('*')
    .single();
  throwIfError(error);
  return data as Employee;
}

export async function getDistrictStores(districtId: string): Promise<Store[]> {
  const { data, error } = await client()
    .from('stores')
    .select('id,organization_id,district_id,store_code,name,active,created_at')
    .eq('district_id', districtId)
    .eq('active', true)
    .order('name');
  throwIfError(error);
  return (data ?? []) as Store[];
}

export async function getDailyHistory(storeId: string, limit = 24): Promise<DailyPerformance[]> {
  const { data, error } = await client()
    .from('daily_performance')
    .select('*')
    .eq('store_id', storeId)
    .order('business_date', { ascending: false })
    .limit(limit);
  throwIfError(error);
  return (data ?? []) as DailyPerformance[];
}
