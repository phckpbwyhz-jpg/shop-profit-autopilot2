import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const safe = (value: unknown) => Math.max(0, Number(value) || 0);

function outputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing access token" }, 401);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "AI coaching is not configured yet. Add the OPENAI_API_KEY Edge Function secret." }, 503);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData.user;
    if (userError || !user) return json({ error: "Invalid user" }, 401);

    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.store_id ?? "");
    const question = String(body?.question ?? "").trim().slice(0, 2000);
    if (!storeId || !question) return json({ error: "store_id and question are required" }, 400);

    const { data: assignment, error: assignmentError } = await admin
      .from("user_assignments")
      .select("organization_id,district_id,store_id,role")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return json({ error: "No active workspace assignment" }, 403);

    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("id,organization_id,district_id,store_code,name,active")
      .eq("id", storeId)
      .eq("active", true)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store || store.organization_id !== assignment.organization_id) {
      return json({ error: "Store not accessible" }, 403);
    }

    const allowed =
      assignment.store_id === store.id ||
      (!assignment.store_id && assignment.district_id === store.district_id) ||
      (!assignment.store_id && !assignment.district_id && ["regional", "owner", "admin"].includes(assignment.role));
    if (!allowed) return json({ error: "Store not accessible" }, 403);

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const next = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const [settingsResult, dailyResult, priorResult] = await Promise.all([
      admin.from("store_month_settings")
        .select("selling_days_total,sales_goal,labor_goal_pct,parts_goal_pct")
        .eq("store_id", store.id).eq("year", year).eq("month", month).maybeSingle(),
      admin.from("daily_performance")
        .select("business_date,selling_day_number,mtd_sales,labor_cost,parts_cost,car_count_mtd")
        .eq("store_id", store.id).gte("business_date", start).lt("business_date", next)
        .order("business_date", { ascending: false }).limit(1).maybeSingle(),
      admin.from("historical_months")
        .select("sales,labor_cost,parts_cost,car_count,selling_days_total")
        .eq("store_id", store.id).eq("year", year - 1).eq("month", month).maybeSingle(),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (dailyResult.error) throw dailyResult.error;
    if (priorResult.error) throw priorResult.error;

    const settings = settingsResult.data;
    const daily = dailyResult.data;
    const prior = priorResult.data;

    const total = safe(settings?.selling_days_total);
    const completed = Math.min(safe(daily?.selling_day_number), total);
    const sales = safe(daily?.mtd_sales);
    const goal = safe(settings?.sales_goal);
    const laborCost = safe(daily?.labor_cost);
    const partsCost = safe(daily?.parts_cost);
    const carCount = safe(daily?.car_count_mtd);
    const projected = completed > 0 ? (sales / completed) * total : 0;
    const remainingDays = Math.max(0, total - completed);
    const remainingSales = goal > 0 ? Math.max(0, goal - sales) : null;
    const needed = goal > 0 && remainingDays > 0 && remainingSales !== null
      ? remainingSales / remainingDays
      : null;
    const laborPct = sales > 0 ? (labor * 0 + laborCost / sales) * 100 : 0;
    const partsPct = sales > 0 ? (partsCost / sales) * 100 : 0;
    const aro = carCount > 0 ? sales / carCount : 0;
    const projectedGoalPct = goal > 0 ? (projected / goal) * 100 : null;
    const projectedYoY = prior && safe(prior.sales) > 0
      ? ((projected - safe(prior.sales)) / safe(prior.sales)) * 100
      : null;

    const snapshot = {
      store: { name: store.name, code: store.store_code },
      period: { year, month, selling_days_completed: completed, selling_days_total: total },
      sales: {
        goal_configured: goal > 0,
        goal: goal > 0 ? goal : null,
        mtd: sales,
        projected_month_end: projected,
        projected_goal_pct: projectedGoalPct,
        remaining_sales: remainingSales,
        needed_per_remaining_day: needed,
      },
      costs: {
        labor_cost_mtd: laborCost,
        labor_pct: laborPct,
        labor_goal_pct: settings?.labor_goal_pct ?? null,
        parts_cost_mtd: partsCost,
        parts_pct: partsPct,
        parts_goal_pct: settings?.parts_goal_pct ?? null,
      },
      operations: { car_count_mtd: carCount, aro },
      history: {
        last_year_final_sales: prior?.sales ?? null,
        projected_vs_last_year_pct: projectedYoY,
      },
    };

    const instructions = `You are Shop Profit Autopilot's AI Manager, an automotive shop operations coach.
Treat VERIFIED SHOP SNAPSHOT as the source of truth for current shop facts.
Never invent a sales goal. When goal_configured is false, say the goal is not configured and do not discuss goal attainment.
You may perform transparent arithmetic for a hypothetical explicitly supplied by the manager using verified snapshot values. For example, if the manager says a hypothetical sale adds zero labor cost, you may add that sale to MTD sales and recompute labor percentage while holding labor_cost_mtd constant. State the assumption clearly.
Do not claim knowledge of open repair orders, future appointments, workload, technician availability, customer intent, or company policy unless explicitly supplied.
When discussing labor reductions, use conditional language such as 'if workload allows'.
Give practical, concise management actions and separate observed facts from what-if results and suggested actions.
Return clean plain text only. Do not use Markdown headings, asterisks, hash symbols, or tables.`;

    const openai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna",
        instructions,
        input: `VERIFIED SHOP SNAPSHOT\n${JSON.stringify(snapshot)}\n\nMANAGER QUESTION\n${question}`,
        max_output_tokens: 700,
      }),
    });

    const payload = await openai.json().catch(() => ({}));
    if (!openai.ok) {
      console.error("OpenAI error", openai.status, payload);
      return json({ error: "AI coaching request failed. Please try again." }, 502);
    }

    const answer = outputText(payload);
    if (!answer) return json({ error: "AI coaching returned no answer." }, 502);
    return json({ answer, model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna" });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
