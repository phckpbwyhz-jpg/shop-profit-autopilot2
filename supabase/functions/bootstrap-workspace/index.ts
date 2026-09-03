import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing access token" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData.user;
    if (userError || !user) return json({ error: "Invalid user" }, 401);

    const body = await req.json();
    // Accept both the mobile app's snake_case payload and camelCase callers.
    const organizationName = String(body.organizationName ?? body.companyName ?? body.organization_name ?? body.company_name ?? "").trim();
    const districtName = String(body.districtName ?? body.district_name ?? "").trim();
    const storeName = String(body.storeName ?? body.store_name ?? "").trim();
    const storeCode = String(body.storeCode ?? body.store_code ?? "").trim() || null;
    const fullName = String(body.fullName ?? body.full_name ?? "").trim() || null;

    if (!organizationName || !districtName || !storeName) {
      return json({ error: "Company, district, and store names are required." }, 400);
    }

    const { data: existing, error: existingError } = await admin
      .from("user_assignments")
      .select("id")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return json({ error: "This account already belongs to a workspace." }, 409);

    const { count: orgCount, error: countError } = await admin.from("organizations").select("id", { count: "exact", head: true });
    if (countError) throw countError;
    if ((orgCount ?? 0) > 0) {
      return json({ error: "A workspace already exists. Ask an administrator to invite or assign this account." }, 409);
    }

    const { data: org, error: orgError } = await admin.from("organizations").insert({ name: organizationName }).select("id,name").single();
    if (orgError) throw orgError;

    const { data: district, error: districtError } = await admin.from("districts").insert({ organization_id: org.id, name: districtName }).select("id,name").single();
    if (districtError) throw districtError;

    const { data: store, error: storeError } = await admin.from("stores").insert({ organization_id: org.id, district_id: district.id, name: storeName, store_code: storeCode }).select("id,name,store_code").single();
    if (storeError) throw storeError;

    const { error: profileError } = await admin.from("profiles").upsert({ user_id: user.id, full_name: fullName });
    if (profileError) throw profileError;

    const { error: assignmentError } = await admin.from("user_assignments").insert({
      user_id: user.id,
      organization_id: org.id,
      district_id: district.id,
      store_id: store.id,
      role: "owner",
      active: true,
    });
    if (assignmentError) throw assignmentError;

    return json({ organization: org, district, store, role: "owner" });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
