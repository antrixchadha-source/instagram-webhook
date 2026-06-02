// Supabase-backed account registry. One row per Instagram account that the
// webhook should engage with.
//
// Expected table — run this once in the Supabase SQL editor:
//
//   create table if not exists accounts (
//     id text primary key,                      -- IG user ID (= webhook entry.id)
//     username text not null,
//     access_token text not null,
//     app_link text not null,
//     brand_mention text,                       -- nullable
//     paused boolean not null default false,
//     dm_disabled boolean not null default false,
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//
import { createClient } from "@supabase/supabase-js";

const TABLE = "accounts";

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

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return supabase;
}

export async function listAccounts() {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from(TABLE).select("*").order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getAccountMap() {
  const rows = await listAccounts();
  const map = new Map();
  for (const a of rows) map.set(a.id, a);
  return map;
}

export async function upsertAccount(account) {
  const supabase = requireSupabase();
  const row = {
    id: String(account.id),
    username: account.username,
    access_token: account.access_token,
    app_link: account.app_link,
    brand_mention: account.brand_mention || null,
    paused: account.paused ?? false,
    dm_disabled: account.dm_disabled ?? false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "id" })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateAccountFields(id, partial) {
  const supabase = requireSupabase();
  const updates = { ...partial, updated_at: new Date().toISOString() };
  delete updates.id;
  const { data, error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq("id", String(id))
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteAccount(id) {
  const supabase = requireSupabase();
  const { error } = await supabase.from(TABLE).delete().eq("id", String(id));
  if (error) throw new Error(error.message);
}

// Strip the access token from a row before shipping it to the browser.
export function redact(account) {
  if (!account) return account;
  const { access_token, ...rest } = account;
  return {
    ...rest,
    access_token_preview: access_token ? `…${access_token.slice(-6)}` : null,
  };
}
