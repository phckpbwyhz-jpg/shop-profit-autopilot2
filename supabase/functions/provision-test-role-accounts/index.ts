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

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = Array.from(bytes, (value) => value.toString(36)).join("").slice(0, 22);
  return `Spa!${token}9Z`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing access token" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid user" }, 401);

    const { data: callerAssignment, error: assignmentError } = await admin
      .from("user_assignments")
      .select("organization_id,district_id,role,active")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!callerAssignment || !["owner", "admin"].includes(callerAssignment.role)) {
      return json({ error: "Owner or Admin access required" }, 403);
    }
    if (!callerAssignment.district_id) return json({ error: "A district-scoped owner/admin assignment is required" }, 409);

    const body = await req.json().catch(() => ({}));
    const storeCode = String(body.store_code ?? "240").trim();
    const prefix = String(body.email_prefix ?? "shopprofitautopilot.test").trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(prefix)) return json({ error: "Invalid email prefix" }, 400);

    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("id,name,store_code,district_id,organization_id")
      .eq("organization_id", callerAssignment.organization_id)
      .eq("district_id", callerAssignment.district_id)
      .eq("store_code", storeCode)
      .eq("active", true)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return json({ error: `Active store ${storeCode} was not found in this district. Load the first-test district data first.` }, 409);

    const requested = [
      { key: "store_manager", email: `${prefix}+store-manager@example.com`, fullName: "Phoenix Central Store Manager Test", role: "store_manager", storeId: store.id },
      { key: "district_manager", email: `${prefix}+district-manager@example.com`, fullName: "Phoenix Central District Manager Test", role: "district_manager", storeId: null },
    ] as const;

    const results: Array<{ key: string; email: string; password?: string; created: boolean }> = [];
    for (const account of requested) {
      const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      let authUser = listed.users.find((candidate) => candidate.email?.toLowerCase() === account.email.toLowerCase()) ?? null;
      let created = false;
      let password: string | undefined;

      if (!authUser) {
        password = randomPassword();
        const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
          email: account.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: account.fullName, test_account: true },
        });
        if (createError || !createdUser.user) throw createError ?? new Error("Could not create test user");
        authUser = createdUser.user;
        created = true;
      }

      const { error: profileError } = await admin.from("profiles").upsert({ user_id: authUser.id, full_name: account.fullName });
      if (profileError) throw profileError;

      const { data: existingAssignment, error: findAssignmentError } = await admin
        .from("user_assignments")
        .select("id")
        .eq("user_id", authUser.id)
        .eq("organization_id", callerAssignment.organization_id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (findAssignmentError) throw findAssignmentError;

      const assignmentValues = {
        organization_id: callerAssignment.organization_id,
        district_id: callerAssignment.district_id,
        store_id: account.storeId,
        role: account.role,
        active: true,
      };
      if (existingAssignment) {
        const { error } = await admin.from("user_assignments").update(assignmentValues).eq("id", existingAssignment.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("user_assignments").insert({ user_id: authUser.id, ...assignmentValues });
        if (error) throw error;
      }

      results.push({ key: account.key, email: account.email, password, created });
    }

    await admin.from("audit_log").insert({
      organization_id: callerAssignment.organization_id,
      entity_type: "test_role_accounts",
      action: "provision",
      actor_user_id: userData.user.id,
      new_data: { store_code: storeCode, accounts: results.map(({ key, email, created }) => ({ key, email, created })) },
    });

    return json({
      store: { id: store.id, name: store.name, store_code: store.store_code },
      accounts: results,
      note: "Passwords are returned only when an account is newly created. Existing test accounts are not reset automatically.",
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
