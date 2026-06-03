// Per-post link overrides for dynamic accounts. When a comment lands on a
// media id that has a row here, the webhook DM uses this link instead of
// the account's default app_link.
//
// Expected table — run once in Supabase SQL editor:
//
//   create table if not exists post_links (
//     account_id text not null references accounts(id) on delete cascade,
//     media_id text not null,
//     link text not null,
//     updated_at timestamptz not null default now(),
//     primary key (account_id, media_id)
//   );
//
import { createClient } from "@supabase/supabase-js";

const TABLE = "post_links";

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
    throw new Error("Supabase not configured");
  }
  return supabase;
}

export async function listPostLinks(accountId) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("account_id", String(accountId));
  if (error) throw new Error(error.message);
  return data || [];
}

// Returns Map<media_id, link> for a given account.
export async function getPostLinkMap(accountId) {
  const rows = await listPostLinks(accountId);
  const map = new Map();
  for (const r of rows) map.set(String(r.media_id), r.link);
  return map;
}

export async function upsertPostLink({ account_id, media_id, link }) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        account_id: String(account_id),
        media_id: String(media_id),
        link,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,media_id" }
    )
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function deletePostLink({ account_id, media_id }) {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("account_id", String(account_id))
    .eq("media_id", String(media_id));
  if (error) throw new Error(error.message);
}
