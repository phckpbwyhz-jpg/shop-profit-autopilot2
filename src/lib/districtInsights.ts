import type { CustomKpi, MonthSettings, Store } from '@/src/types/app';
import type { PerformanceMetrics } from '@/src/types/performance';

export interface DistrictStoreSnapshot {
  store: Store;
  settings: MonthSettings | null;
  metrics: PerformanceMetrics;
  mtdSales: number;
  laborCost: number;
  partsCost: number;
  kpis: CustomKpi[];
}

export interface DistrictStoreRanking {
  storeId: string;
  storeName: string;
  score: number;
  hasSalesGoal: boolean;
  projectedGoalPercent: number;
  projectedMonthEnd: number;
  projectedYearOverYearPercent: number | null;
  laborPercent: number;
  partsPercent: number;
  sameDayYearOverYearPercent: number | null;
}

export interface DistrictPriority {
  id: string;
  title: string;
  detail: string;
  action: string;
  severity: 'critical' | 'warning' | 'opportunity' | 'positive';
  score: number;
}

export interface DistrictCommandCenter {
  totalMtdSales: number;
  totalSalesGoal: number;
  hasDistrictSalesGoal: boolean;
  projectedMonthEnd: number;
  projectedGoalPercent: number;
  laborPercent: number;
  partsPercent: number;
  storesOnPace: number;
  storesWithSalesGoals: number;
  storeCount: number;
  rankings: DistrictStoreRanking[];
  priorities: DistrictPriority[];
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function hasSalesGoal(snapshot: DistrictStoreSnapshot): boolean {
  return Number(snapshot.settings?.sales_goal ?? 0) > 0;
}

function storeScore(snapshot: DistrictStoreSnapshot): number {
  const laborGoal = snapshot.settings?.labor_goal_pct === null || snapshot.settings?.labor_goal_pct === undefined
    ? null
    : Number(snapshot.settings.labor_goal_pct);
  const partsGoal = snapshot.settings?.parts_goal_pct === null || snapshot.settings?.parts_goal_pct === undefined
    ? null
    : Number(snapshot.settings.parts_goal_pct);
  const laborPenalty = laborGoal === null ? 0 : Math.max(0, snapshot.metrics.laborPercent - laborGoal) * 3;
  const partsPenalty = partsGoal === null ? 0 : Math.max(0, snapshot.metrics.partsPercent - partsGoal) * 4;
  const sameDayYoy = snapshot.metrics.sameDayYearOverYearPercent;
  const sameDayAdjustment = sameDayYoy === null ? 0 : Math.max(-10, Math.min(10, sameDayYoy)) * 0.25;
  const base = hasSalesGoal(snapshot)
    ? snapshot.metrics.projectedGoalPercent
    : 100 + Math.max(-50, Math.min(50, snapshot.metrics.projectedYearOverYearPercent ?? 0));
  return finite(base - laborPenalty - partsPenalty + sameDayAdjustment);
}

export function buildDistrictCommandCenter(stores: DistrictStoreSnapshot[]): DistrictCommandCenter {
  const totalMtdSales = stores.reduce((sum, store) => sum + store.mtdSales, 0);
  const storesWithGoals = stores.filter(hasSalesGoal);
  const totalSalesGoal = storesWithGoals.reduce((sum, store) => sum + Number(store.settings?.sales_goal ?? 0), 0);
  const projectedMonthEnd = stores.reduce((sum, store) => sum + store.metrics.projectedMonthEnd, 0);
  const projectedForGoalStores = storesWithGoals.reduce((sum, store) => sum + store.metrics.projectedMonthEnd, 0);
  const totalLaborCost = stores.reduce((sum, store) => sum + store.laborCost, 0);
  const totalPartsCost = stores.reduce((sum, store) => sum + store.partsCost, 0);
  const projectedGoalPercent = totalSalesGoal > 0 ? (projectedForGoalStores / totalSalesGoal) * 100 : 0;
  const laborPercent = totalMtdSales > 0 ? (totalLaborCost / totalMtdSales) * 100 : 0;
  const partsPercent = totalMtdSales > 0 ? (totalPartsCost / totalMtdSales) * 100 : 0;

  const rankings = stores
    .map((store) => ({
      storeId: store.store.id,
      storeName: store.store.name,
      score: storeScore(store),
      hasSalesGoal: hasSalesGoal(store),
      projectedGoalPercent: store.metrics.projectedGoalPercent,
      projectedMonthEnd: store.metrics.projectedMonthEnd,
      projectedYearOverYearPercent: store.metrics.projectedYearOverYearPercent,
      laborPercent: store.metrics.laborPercent,
      partsPercent: store.metrics.partsPercent,
      sameDayYearOverYearPercent: store.metrics.sameDayYearOverYearPercent,
    }))
    .sort((a, b) => b.score - a.score);

  const priorities: DistrictPriority[] = [];
  const goalRankings = rankings.filter((store) => store.hasSalesGoal);
  const weakestGoalStore = goalRankings[goalRankings.length - 1];
  if (weakestGoalStore && weakestGoalStore.projectedGoalPercent < 100) {
    priorities.push({
      id: 'store-attention',
      title: `${weakestGoalStore.storeName} needs attention`,
      detail: `Current pace projects ${weakestGoalStore.projectedGoalPercent.toFixed(1)}% of its own sales goal.`,
      action: 'Coach the store on the gap to its own daily pace. Check car count, ARO, inspection execution, and declined-work follow-up before choosing the response.',
      severity: weakestGoalStore.projectedGoalPercent < 90 ? 'critical' : 'warning',
      score: 100 + Math.max(0, 100 - weakestGoalStore.projectedGoalPercent),
    });
  } else if (!goalRankings.length) {
    const yoyStores = rankings
      .filter((store) => store.projectedYearOverYearPercent !== null)
      .sort((a, b) => (a.projectedYearOverYearPercent ?? 0) - (b.projectedYearOverYearPercent ?? 0));
    const weakestYoy = yoyStores[0];
    if (weakestYoy && (weakestYoy.projectedYearOverYearPercent ?? 0) < 0) {
      const yoy = weakestYoy.projectedYearOverYearPercent ?? 0;
      priorities.push({
        id: 'store-attention-yoy',
        title: `${weakestYoy.storeName} is pacing below last year`,
        detail: `Current selling-day pace projects ${Math.abs(yoy).toFixed(1)}% below last year's completed month. Sales goal is not configured, so this is a TY/LY signal rather than a goal-performance claim.`,
        action: 'Review car count and ARO first, then coach the controllable driver. Add the official monthly goal when available to unlock goal-based pacing.',
        severity: yoy <= -10 ? 'critical' : 'warning',
        score: 100 + Math.abs(yoy),
      });
    }
  }

  const laborIssue = stores
    .map((store) => ({ store, goal: store.settings?.labor_goal_pct === null || store.settings?.labor_goal_pct === undefined ? null : Number(store.settings.labor_goal_pct) }))
    .filter((item) => item.goal !== null && item.store.metrics.laborPercent > item.goal)
    .sort((a, b) => (b.store.metrics.laborPercent - (b.goal ?? 0)) - (a.store.metrics.laborPercent - (a.goal ?? 0)))[0];
  if (laborIssue && laborIssue.goal !== null) {
    const gap = laborIssue.store.metrics.laborPercent - laborIssue.goal;
    priorities.push({
      id: 'labor-gap',
      title: `Labor pressure at ${laborIssue.store.store.name}`,
      detail: `Labor is ${laborIssue.store.metrics.laborPercent.toFixed(1)}% versus a ${laborIssue.goal.toFixed(1)}% goal.`,
      action: 'Review controllable straight-time hours and staffing plan with the manager. Any reduction should be conditional on actual workload; future work and sales impact are not assumed.',
      severity: gap >= 3 ? 'critical' : 'warning',
      score: 92 + gap * 3,
    });
  }

  const partsIssue = stores
    .map((store) => ({ store, goal: store.settings?.parts_goal_pct === null || store.settings?.parts_goal_pct === undefined ? null : Number(store.settings.parts_goal_pct) }))
    .filter((item) => item.goal !== null && item.store.metrics.partsPercent > item.goal)
    .sort((a, b) => (b.store.metrics.partsPercent - (b.goal ?? 0)) - (a.store.metrics.partsPercent - (a.goal ?? 0)))[0];
  if (partsIssue && partsIssue.goal !== null) {
    const gap = partsIssue.store.metrics.partsPercent - partsIssue.goal;
    priorities.push({
      id: 'parts-gap',
      title: `Parts cost pressure at ${partsIssue.store.store.name}`,
      detail: `Parts cost is ${partsIssue.store.metrics.partsPercent.toFixed(1)}% versus a ${partsIssue.goal.toFixed(1)}% goal.`,
      action: 'Audit high-dollar tickets, sourcing, pricing, credits, and missed returns with the store before changing selling behavior.',
      severity: gap >= 2 ? 'critical' : 'warning',
      score: 90 + gap * 4,
    });
  }

  const leader = rankings[0];
  if (leader) {
    const leaderDetail = leader.hasSalesGoal
      ? `It currently leads the district performance score at ${leader.projectedGoalPercent.toFixed(1)}% projected to its own sales goal.`
      : leader.projectedYearOverYearPercent !== null
        ? `It currently leads the district performance score while pacing ${leader.projectedYearOverYearPercent >= 0 ? '+' : ''}${leader.projectedYearOverYearPercent.toFixed(1)}% versus last year's completed month.`
        : 'It currently leads the available district performance signals.';
    priorities.push({
      id: 'recognition',
      title: `Recognize ${leader.storeName}`,
      detail: leaderDetail,
      action: 'Recognize the result and ask what repeatable process is driving it so the district can share the tactic.',
      severity: 'positive',
      score: 35,
    });
  }

  return {
    totalMtdSales,
    totalSalesGoal,
    hasDistrictSalesGoal: totalSalesGoal > 0,
    projectedMonthEnd,
    projectedGoalPercent,
    laborPercent,
    partsPercent,
    storesOnPace: goalRankings.filter((store) => store.projectedGoalPercent >= 100).length,
    storesWithSalesGoals: goalRankings.length,
    storeCount: rankings.length,
    rankings,
    priorities: priorities.sort((a, b) => b.score - a.score).slice(0, 3),
  };
}
