export interface PerformanceInput {
  monthlySalesGoal: number;
  mtdSales: number;
  laborCost: number;
  partsCost: number;
  carCount: number;
  sellingDaysCompleted: number;
  totalSellingDays: number;
  lastYearCompletedMonthSales?: number;
  lastYearSameSellingDaySales?: number;
}

export interface PerformanceMetrics {
  projectedMonthEnd: number;
  projectedGoalPercent: number;
  remainingSalesNeeded: number;
  remainingSellingDays: number;
  salesNeededPerRemainingDay: number;
  laborPercent: number;
  partsPercent: number;
  averageRepairOrder: number;
  projectedYearOverYearPercent: number | null;
  sameDayYearOverYearPercent: number | null;
}

export interface PerformanceSnapshot extends PerformanceInput {
  id: string;
  recordedAt: string;
  metrics: PerformanceMetrics;
}
