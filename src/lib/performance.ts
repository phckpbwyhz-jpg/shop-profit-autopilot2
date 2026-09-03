import type { PerformanceInput, PerformanceMetrics } from '@/src/types/performance';

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function percentChange(current: number, comparison?: number): number | null {
  if (comparison === undefined || comparison <= 0) return null;
  return ((current - comparison) / comparison) * 100;
}

export function calculatePerformance(input: PerformanceInput): PerformanceMetrics {
  const mtdSales = finiteNonNegative(input.mtdSales);
  const completed = Math.min(
    finiteNonNegative(input.sellingDaysCompleted),
    finiteNonNegative(input.totalSellingDays),
  );
  const total = finiteNonNegative(input.totalSellingDays);
  const projectedMonthEnd = completed > 0 ? (mtdSales / completed) * total : 0;
  const goal = finiteNonNegative(input.monthlySalesGoal);
  const remainingSellingDays = Math.max(0, total - completed);
  const remainingSalesNeeded = Math.max(0, goal - mtdSales);

  return {
    projectedMonthEnd,
    projectedGoalPercent: goal > 0 ? (projectedMonthEnd / goal) * 100 : 0,
    remainingSalesNeeded,
    remainingSellingDays,
    salesNeededPerRemainingDay:
      remainingSellingDays > 0 ? remainingSalesNeeded / remainingSellingDays : 0,
    laborPercent: mtdSales > 0 ? (finiteNonNegative(input.laborCost) / mtdSales) * 100 : 0,
    partsPercent: mtdSales > 0 ? (finiteNonNegative(input.partsCost) / mtdSales) * 100 : 0,
    averageRepairOrder:
      input.carCount > 0 ? mtdSales / finiteNonNegative(input.carCount) : 0,
    projectedYearOverYearPercent: percentChange(
      projectedMonthEnd,
      input.lastYearCompletedMonthSales,
    ),
    sameDayYearOverYearPercent: percentChange(
      mtdSales,
      input.lastYearSameSellingDaySales,
    ),
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? 'Not available' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function costFromPercentage(sales: number, percentage: number): number {
  const safeSales = finiteNonNegative(sales);
  const safePercentage = finiteNonNegative(percentage);
  return (safeSales * safePercentage) / 100;
}

export function percentageFromCost(cost: number, sales: number): number {
  const safeSales = finiteNonNegative(sales);
  if (safeSales === 0) return 0;
  return (finiteNonNegative(cost) / safeSales) * 100;
}
