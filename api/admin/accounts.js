import {
  listAccounts,
  upsertAccount,
  updateAccountFields,
  deleteAccount,
  redact,
} from "../../lib/accounts.js";
import { whoami, subscribeToComments } from "../../lib/ig.js";
import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

const ALLOWED_PATCH_FIELDS = new Set([
  "paused",
  "dm_disabled",
  "access_token",
  "app_link",
  "brand_mention",
  "username",
]);

export default async function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);

  try {
    if (req.method === "GET") {
      const rows = await listAccounts();
      return res.status(200).json(rows.map(redact));
    }

    if (req.method === "POST") {
      const { ig_user_id, access_token, app_link, brand_mention } = req.body || {};
      if (!ig_user_id || !access_token || !app_link) {
        return res.status(400).send("ig_user_id, access_token, and app_link are required");
      }

      // 1. Verify the token by calling /me. Username comes from here.
      let me;
      try {
        me = await whoami(access_token);
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        return res.status(400).send(`Token rejected by Graph API: ${msg}`);
      }

      // 2. Subscribe the IG user to the comments field (idempotent).
      try {
        await subscribeToComments(ig_user_id, access_token);
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        return res.status(400).send(`Webhook subscription failed: ${msg}`);
      }

      // 3. Persist.
      const saved = await upsertAccount({
        id: ig_user_id,
        username: me.username || ig_user_id,
        access_token,
        app_link,
        brand_mention: brand_mention?.trim() || null,
        paused: false,
        dm_disabled: false,
      });

      return res.status(200).json(redact(saved));
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).send("id query param required");
      const updates = {};
      for (const k of Object.keys(req.body || {})) {
        if (ALLOWED_PATCH_FIELDS.has(k)) updates[k] = req.body[k];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).send("no allowed fields in body");
      }
      const saved = await updateAccountFields(id, updates);
      if (!saved) return res.status(404).send("Account not found");
      return res.status(200).json(redact(saved));
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).send("id query param required");
      await deleteAccount(id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).send("Method not allowed");
  } catch (err) {
    console.error("accounts handler failed:", err.message);
    return res.status(500).send(err.message);
  }
}
