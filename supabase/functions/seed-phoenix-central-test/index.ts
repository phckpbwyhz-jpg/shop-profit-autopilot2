import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fixture = [
  { code: "122", name: "122-Thomas", sales: 8401, cars: 24, partsPct: 25.04, laborPct: 28.38, lySales: 112052, lyCars: 280 },
  { code: "128", name: "128-Ray Rd.", sales: 3803, cars: 23, partsPct: 25.77, laborPct: 25.49, lySales: 85630, lyCars: 299 },
  { code: "146", name: "146-Hayden", sales: 7187, cars: 20, partsPct: 19.53, laborPct: 32.48, lySales: 102060, lyCars: 223 },
  { code: "148", name: "148-Scottsdale", sales: 7346, cars: 29, partsPct: 25.91, laborPct: 20.95, lySales: 77011, lyCars: 293 },
  { code: "236", name: "236-Lower Buckeye", sales: 6223, cars: 25, partsPct: 27.90, laborPct: 34.39, lySales: 99734, lyCars: 329 },
  { code: "240", name: "240-24th", sales: 8270, cars: 39, partsPct: 24.87, laborPct: 35.85, lySales: 114825, lyCars: 524 },
  { code: "244", name: "244-Baseline", sales: 6413, cars: 44, partsPct: 21.44, laborPct: 28.93, lySales: 100828, lyCars: 420 },
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing access token" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid user" }, 401);
    const user = userData.user;

    const { data: assignment, error: assignmentError } = await admin
      .from("user_assignments")
      .select("id,organization_id,district_id,store_id,role")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment || !assignment.district_id || !assignment.organization_id) return json({ error: "An active district-scoped assignment is required." }, 403);
    if (!['owner', 'admin'].includes(String(assignment.role))) return json({ error: "Owner or Admin access is required." }, 403);

    const body = await req.json().catch(() => ({}));
    const primaryStoreCode = String(body.primary_store_code ?? "244").trim();
    if (!fixture.some((item) => item.code === primaryStoreCode)) return json({ error: "Choose a valid Phoenix Central store code." }, 400);

    const { data: existingStores, error: storesError } = await admin
      .from("stores")
      .select("id,store_code,name,active")
      .eq("district_id", assignment.district_id);
    if (storesError) throw storesError;

    const existingIds = (existingStores ?? []).map((row) => row.id);
    if (existingIds.length) {
      const { count, error: dailyCountError } = await admin
        .from("daily_performance")
        .select("id", { count: "exact", head: true })
        .in("store_id", existingIds);
      if (dailyCountError) throw dailyCountError;
      const fixtureCodes = new Set(fixture.map((item) => item.code));
      const hasFixtureStore = (existingStores ?? []).some((row) => row.store_code && fixtureCodes.has(String(row.store_code) as typeof fixture[number]['code']));
      if ((count ?? 0) > 0 && !hasFixtureStore) return json({ error: "This district already contains live daily data. Test seeding was blocked." }, 409);
    }

    const seededStores: Array<{ id: string; code: string; name: string }> = [];
    for (const item of fixture) {
      let store = (existingStores ?? []).find((row) => String(row.store_code ?? "") === item.code);
      if (store) {
        const { data, error } = await admin.from("stores").update({ name: item.name, active: true }).eq("id", store.id).select("id,store_code,name").single();
        if (error) throw error;
        store = data;
      } else {
        const { data, error } = await admin.from("stores").insert({
          organization_id: assignment.organization_id,
          district_id: assignment.district_id,
          store_code: item.code,
          name: item.name,
          active: true,
        }).select("id,store_code,name").single();
        if (error) throw error;
        store = data;
      }
      seededStores.push({ id: store.id, code: item.code, name: item.name });

      const { data: monthSetting, error: settingFindError } = await admin.from("store_month_settings").select("id").eq("store_id", store.id).eq("year", 2026).eq("month", 9).maybeSingle();
      if (settingFindError) throw settingFindError;
      const settingPayload = { selling_days_total: 25, sales_goal: 0, labor_goal_pct: null, parts_goal_pct: null };
      const settingQuery = monthSetting
        ? admin.from("store_month_settings").update(settingPayload).eq("id", monthSetting.id)
        : admin.from("store_month_settings").insert({ store_id: store.id, year: 2026, month: 9, ...settingPayload, created_by: user.id });
      const { error: settingWriteError } = await settingQuery;
      if (settingWriteError) throw settingWriteError;

      const { data: daily, error: dailyFindError } = await admin.from("daily_performance").select("id").eq("store_id", store.id).eq("business_date", "2026-09-03").maybeSingle();
      if (dailyFindError) throw dailyFindError;
      const dailyPayload = {
        selling_day_number: 2,
        mtd_sales: item.sales,
        labor_cost: Number((item.sales * item.laborPct / 100).toFixed(2)),
        parts_cost: Number((item.sales * item.partsPct / 100).toFixed(2)),
        car_count_mtd: item.cars,
      };
      const dailyQuery = daily
        ? admin.from("daily_performance").update({ ...dailyPayload, updated_by: user.id }).eq("id", daily.id)
        : admin.from("daily_performance").insert({ store_id: store.id, business_date: "2026-09-03", ...dailyPayload, entered_by: user.id });
      const { error: dailyWriteError } = await dailyQuery;
      if (dailyWriteError) throw dailyWriteError;

      const { data: historical, error: historicalFindError } = await admin.from("historical_months").select("id").eq("store_id", store.id).eq("year", 2025).eq("month", 9).maybeSingle();
      if (historicalFindError) throw historicalFindError;
      const historicalPayload = { selling_days_total: null, sales: item.lySales, labor_cost: null, parts_cost: null, car_count: item.lyCars };
      const historicalQuery = historical
        ? admin.from("historical_months").update(historicalPayload).eq("id", historical.id)
        : admin.from("historical_months").insert({ store_id: store.id, year: 2025, month: 9, ...historicalPayload, entered_by: user.id });
      const { error: historicalWriteError } = await historicalQuery;
      if (historicalWriteError) throw historicalWriteError;
    }

    const fixtureIds = new Set(seededStores.map((store) => store.id));
    for (const store of existingStores ?? []) {
      if (!fixtureIds.has(store.id)) {
        const { error } = await admin.from("stores").update({ active: false }).eq("id", store.id);
        if (error) throw error;
      }
    }

    const primaryStore = seededStores.find((store) => store.code === primaryStoreCode)!;
    const { error: assignmentUpdateError } = await admin.from("user_assignments").update({ store_id: primaryStore.id }).eq("id", assignment.id);
    if (assignmentUpdateError) throw assignmentUpdateError;

    const { error: auditError } = await admin.from("audit_log").insert({
      organization_id: assignment.organization_id,
      store_id: primaryStore.id,
      entity_type: "test_fixture",
      action: "seed_phoenix_central",
      new_data: { fixture_date: "2026-09-03", stores: seededStores.map((store) => store.code), primary_store_code: primaryStoreCode },
      actor_user_id: user.id,
    });
    if (auditError) throw auditError;

    return json({ ok: true, district_id: assignment.district_id, primary_store: primaryStore, stores: seededStores });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
