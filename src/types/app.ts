export const APP_ROLES = [
  'assistant_manager',
  'store_manager',
  'district_manager',
  'regional',
  'owner',
  'admin',
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type AppSection = 'home' | 'numbers' | 'history' | 'team' | 'kpis';
export type PayType = 'straight_hourly' | 'flat_rate' | 'salary';
export type KpiTrackingType = 'dollars' | 'percentage' | 'units';
export type KpiGoalDirection = 'higher' | 'lower';

export interface UserAssignment {
  id: string;
  user_id: string;
  organization_id: string;
  district_id: string | null;
  store_id: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
}

export interface Store {
  id: string;
  organization_id: string;
  district_id: string;
  store_code: string | null;
  name: string;
  active: boolean;
  created_at: string;
}

export interface MonthSettings {
  id: string;
  store_id: string;
  year: number;
  month: number;
  selling_days_total: number;
  sales_goal: number;
  labor_goal_pct: number | null;
  parts_goal_pct: number | null;
  created_by: string;
  updated_at: string;
}

export interface DailyPerformance {
  id: string;
  store_id: string;
  business_date: string;
  selling_day_number: number;
  mtd_sales: number;
  labor_cost: number | null;
  parts_cost: number | null;
  car_count_mtd: number | null;
  entered_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HistoricalMonth {
  id: string;
  store_id: string;
  year: number;
  month: number;
  selling_days_total: number | null;
  sales: number;
  labor_cost: number | null;
  parts_cost: number | null;
  car_count: number | null;
  entered_by: string | null;
  updated_at: string;
}

export interface CustomKpi {
  id: string;
  name: string;
  tracking_type: KpiTrackingType;
  goal_direction: KpiGoalDirection;
  required: boolean;
  monthly_goal: number | null;
  current_value: number | null;
}

export interface Employee {
  id: string;
  store_id: string;
  employee_name: string;
  position_title: string | null;
  pay_type: PayType;
  pay_rate: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BootstrapWorkspaceInput {
  companyName: string;
  districtName: string;
  storeName: string;
  fullName: string;
}

const ROLE_RANK: Record<AppRole, number> = {
  assistant_manager: 0,
  store_manager: 1,
  district_manager: 2,
  regional: 3,
  owner: 4,
  admin: 5,
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function hasMinimumRole(role: AppRole, minimum: AppRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canViewTeamWages(role: AppRole): boolean {
  return hasMinimumRole(role, 'store_manager');
}

export function sectionsForRole(role: AppRole): AppSection[] {
  const sections: AppSection[] = canViewTeamWages(role)
    ? ['home', 'numbers', 'history', 'team']
    : ['home', 'numbers', 'history'];
  if (hasMinimumRole(role, 'district_manager')) sections.push('kpis');
  return sections;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  assistant_manager: 'Assistant Manager',
  store_manager: 'Store Manager',
  district_manager: 'District Manager',
  regional: 'Regional',
  owner: 'Owner',
  admin: 'Admin',
};
