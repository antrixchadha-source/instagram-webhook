// Toggle flags backed by Supabase. When Supabase isn't configured (no env
// vars), reads fall back to the legacy env-var values so the webhook keeps
// working unchanged.
//
// Expected table — run this once in the Supabase SQL editor:
//
//   create table if not exists webhook_settings (
//     id text primary key,
//     flags jsonb not null default '{}'::jsonb,
//     updated_at timestamptz not null default now()
//   );
//   insert into webhook_settings (id, flags) values ('default', '{}'::jsonb)
//     on conflict (id) do nothing;
//
import { createClient } from "@supabase/supabase-js";

const SETTINGS_ID = "default";
const TABLE = "webhook_settings";

const truthy = (v) => {
  const s = (v ?? "").trim().toLowerCase();
  return !!s && s !== "false" && s !== "0";
};

const ENV_DEFAULTS = () => ({
  riddhi_paused: truthy(process.env.IG_PAUSED),
  riddhi_dm_disabled: truthy(process.env.IG_DM_DISABLED),
  hershey_paused: truthy(process.env.HERSHEY_PAUSED),
  hershey_dm_disabled: truthy(process.env.HERSHEY_DM_DISABLED),
});

export const VALID_FLAGS = new Set([
  "riddhi_paused",
  "riddhi_dm_disabled",
  "hershey_paused",
  "hershey_dm_disabled",
]);

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

export async function readFlags() {
  const defaults = ENV_DEFAULTS();
  const supabase = getSupabase();
  if (!supabase) return defaults;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("flags")
      .eq("id", SETTINGS_ID)
      .maybeSingle();
    if (error) throw error;
    const stored = data?.flags || {};
    return { ...defaults, ...stored };
  } catch (err) {
    console.error("⚠️ flags read failed, using env defaults:", err.message);
    return defaults;
  }
}

export async function writeFlag(key, value) {
  if (!VALID_FLAGS.has(key)) {
    throw new Error(`unknown flag: ${key}`);
  }
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const current = await readFlags();
  current[key] = !!value;
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { id: SETTINGS_ID, flags: current, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
  return current;
}
