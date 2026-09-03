import type { Employee, EmployeeTimePlan } from '@/src/types/app';

export interface LaborPlanRow { employee: Employee; scheduledHours: number; actualHours: number | null; plannedCost: number; controllableHourly: boolean; }
export interface LaborScenario { currentMtdLaborCost:number; mtdSales:number; cutHours:number; hourlyRate:number; savings:number; laborAfter:number; laborPctBefore:number; laborPctAfter:number; goalPct:number|null; dollarsToGoal:number|null; hoursToGoalAtRate:number|null; }

export function plannedLaborCost(employee:Employee,hours:number):number {
  const safeHours=Math.max(0,hours);
  if(employee.pay_type==='straight_hourly') return safeHours*Number(employee.pay_rate);
  if(employee.pay_type==='flat_rate') return safeHours*Number(employee.pay_rate); // hours here represent paid/flagged hours, not clock hours
  return 0; // salary is not treated as incremental hourly cost in a daily what-if
}

export function buildLaborRows(employees:Employee[],plans:EmployeeTimePlan[]):LaborPlanRow[]{
  const byEmployee=new Map(plans.map(p=>[p.employee_id,p]));
  return employees.map(employee=>{const plan=byEmployee.get(employee.id);const hours=Number(plan?.actual_hours ?? plan?.scheduled_hours ?? 0);return {employee,scheduledHours:Number(plan?.scheduled_hours??0),actualHours:plan?.actual_hours===null||plan?.actual_hours===undefined?null:Number(plan.actual_hours),plannedCost:plannedLaborCost(employee,hours),controllableHourly:employee.pay_type==='straight_hourly'};});
}

export function laborScenario(input:{currentMtdLaborCost:number;mtdSales:number;cutHours:number;hourlyRate:number;goalPct:number|null}):LaborScenario{
  const current=Math.max(0,input.currentMtdLaborCost);const sales=Math.max(0,input.mtdSales);const cut=Math.max(0,input.cutHours);const rate=Math.max(0,input.hourlyRate);const savings=cut*rate;const after=Math.max(0,current-savings);const beforePct=sales>0?current/sales*100:0;const afterPct=sales>0?after/sales*100:0;
  let dollarsToGoal:null|number=null;let hoursToGoalAtRate:null|number=null;
  if(input.goalPct!==null&&sales>0){const target=sales*(input.goalPct/100);dollarsToGoal=Math.max(0,current-target);hoursToGoalAtRate=rate>0?dollarsToGoal/rate:null;}
  return {currentMtdLaborCost:current,mtdSales:sales,cutHours:cut,hourlyRate:rate,savings,laborAfter:after,laborPctBefore:beforePct,laborPctAfter:afterPct,goalPct:input.goalPct,dollarsToGoal,hoursToGoalAtRate};
}
