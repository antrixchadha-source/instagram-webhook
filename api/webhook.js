// File: /api/webhook.js
import axios from "axios";
import { waitUntil } from "@vercel/functions";
import { readFlags } from "../lib/flags.js";
import { getAccountMap, effectiveAppLink } from "../lib/accounts.js";
import { getPostLinkMap } from "../lib/post_links.js";

const {
  VERIFY_TOKEN,
  WEBHOOK_PAUSED,
  HERSHEY_USER_ID,
  HERSHEY_TOKEN,
  HERSHEY_APP_LINK,
} = process.env;

const truthy = (v) => {
  const s = (v ?? "").trim().toLowerCase();
  return !!s && s !== "false" && s !== "0";
};

const GRAPH = "https://graph.instagram.com/v25.0";

const greetings = [
  (name) => `Hey ${name}! 👋`,
  (name) => `Hi ${name} 🙌`,
  (name) => `Yo ${name}!`,
  (name) => `${name}! Saw your comment 🙏`,
  (name) => `Heyy ${name} ✨`,
];

const linkLines = [
  (link) => `Here's what you're looking for 👉 ${link}`,
  (link) => `Grab it here: ${link}`,
  (link) => `Check this out → ${link}`,
  (link) => `This is the link :\n${link}`,
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 2534025 is overloaded — it covers legitimately invalid cases (old comment,
// already-replied, etc.) AND a race condition where Meta's webhook service
// delivers the event before its messaging service has indexed the comment.
// Retry with backoff so transient races recover automatically. Total wait
// budget across retries: ~38s, fits inside the 60s function maxDuration.
const DM_RETRY_DELAYS_MS = [3000, 10000, 25000];
async function sendDMWithRetry(label, doPost) {
  for (let attempt = 0; attempt <= DM_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await doPost();
    } catch (err) {
      const subcode = err.response?.data?.error?.error_subcode;
      const last = attempt === DM_RETRY_DELAYS_MS.length;
      if (subcode !== 2534025 || last) throw err;
      const wait = DM_RETRY_DELAYS_MS[attempt];
      console.log(`⏳ ${label} hit 2534025, retrying in ${wait / 1000}s (attempt ${attempt + 2}/${DM_RETRY_DELAYS_MS.length + 1})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export default async function handler(req, res) {
  // ---- GET: Webhook verification ----
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(String(challenge));
    }
    return res.status(403).send("Forbidden");
  }

  // ---- POST: Comment events ----
  if (req.method === "POST") {
    // Emergency global kill-switch via env var. The per-account toggles are
    // in Redis (see flags.js); this env var lets you stop everything in one
    // shot without depending on Redis being reachable.
    if (truthy(WEBHOOK_PAUSED)) {
      console.log("⏸️ WEBHOOK_PAUSED — acking without processing");
      return res.status(200).send("OK");
    }

    console.log("📥 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));

    // Per-account flags for the hardcoded riddhi/hershey accounts live in
    // Supabase webhook_settings (toggled via /api/admin). Additional
    // accounts (added through the Add Account dashboard form) live in the
    // accounts table — we read them here and route on demand below.
    const flags = await readFlags();
    console.log("🎛 flags:", JSON.stringify(flags));

    let extraAccounts = new Map();
    try {
      extraAccounts = await getAccountMap();
    } catch (err) {
      console.error("⚠️ extra accounts read failed:", err.message);
    }

    const entries = req.body?.entry || [];
    for (const entry of entries) {
      const ownerId = entry?.id;
      for (const change of entry.changes || []) {
        if (change.field !== "comments") continue;

        const c = change.value;
        const commentId = c.id;
        const fromId = c.from?.id;
        const username = c.from?.username;
        const parentId = c.parent_id;
        const mediaId = c.media?.id;
        const text = c.text || "";

        if (!commentId) {
          console.error("❌ No commentId in payload");
          continue;
        }

        if (parentId) {
          console.log("⏭️ Reply comment, skipping");
          continue;
        }

        // Skip our own comments to avoid loops
        if (fromId === ownerId) {
          console.log("⏭️ Own comment, skipping");
          continue;
        }

        console.log(`💬 ${username || fromId}: "${text}"`);

        // Route to the right account handler.
        if (ownerId === HERSHEY_USER_ID) {
          if (flags.hershey_paused) {
            console.log("⏸️ hershey paused — skipping");
            continue;
          }
          waitUntil(processHersheyComment({ commentId, username, skipDM: flags.hershey_dm_disabled }));
        } else {
          const extra = extraAccounts.get(ownerId);
          if (!extra) {
            console.log(`⏭️ no handler for owner ${ownerId}`);
            continue;
          }
          if (extra.paused) {
            console.log(`⏸️ [${extra.username}] paused — skipping`);
            continue;
          }
          waitUntil(processAccountComment(extra, { commentId, username, mediaId }));
        }
      }
    }

    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

// ============================================================
// hersheytravels2 handlers
// ============================================================

function buildHersheyDM({ username }) {
  const name = username ? `@${username}` : "there";
  return [pick(greetings)(name), pick(linkLines)(HERSHEY_APP_LINK)].join("\n\n");
}

function pickHersheyPublicReply(privateReplySent) {
  const dmSentOpts = [
    `Just sent you a DM 📩`,
    `Check your DMs! 💌`,
    `DM sent your way 🚀`,
    `Replied in your inbox ✨`,
  ];
  const fallbackOpts = [
    `Check your DMs in a sec ✨`,
    `DM coming your way 🚀`,
  ];
  return pick(privateReplySent ? dmSentOpts : fallbackOpts).trim();
}

async function processHersheyComment({ commentId, username, skipDM }) {
  let privateReplySent = false;
  if (skipDM) {
    console.log("⏭️ [hershey] DMs disabled — public reply only");
  } else {
    const message = buildHersheyDM({ username });
    try {
      await sendHersheyPrivateReply(commentId, message);
      privateReplySent = true;
    } catch (err) {
      console.error("⚠️ [hershey] DM failed, attempting public reply");
    }
  }
  try {
    await replyHersheyPublicly(commentId, pickHersheyPublicReply(privateReplySent));
  } catch (err) {
    console.error(
      "❌ [hershey] Public reply failed:",
      err.response?.status,
      JSON.stringify(err.response?.data || err.message)
    );
  }
}

async function sendHersheyPrivateReply(commentId, text) {
  const url = `${GRAPH}/${HERSHEY_USER_ID}/messages`;
  console.log("🚀 [hershey] sending DM via:", url);
  try {
    const { data } = await sendDMWithRetry("[hershey] DM", () =>
      axios.post(
        url,
        { recipient: { comment_id: commentId }, message: { text } },
        { params: { access_token: HERSHEY_TOKEN } }
      )
    );
    console.log("📨 [hershey] DM sent:", JSON.stringify(data));
  } catch (err) {
    console.error(
      "💥 [hershey] DM FAILED:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw err;
  }
}

async function replyHersheyPublicly(commentId, message) {
  const url = `${GRAPH}/${commentId}/replies`;
  try {
    await axios.post(url, null, {
      params: { message, access_token: HERSHEY_TOKEN },
    });
    console.log("💬 [hershey] public reply posted");
  } catch (err) {
    console.error(
      "⚠️ [hershey] public reply failed:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
  }
}

// ============================================================
// Generic handler for accounts added via /api/admin (accounts table)
// ============================================================

function buildAccountDM(username, appLink) {
  const name = username ? `@${username}` : "there";
  return [pick(greetings)(name), pick(linkLines)(appLink)].join("\n\n");
}

function pickAccountPublicReply(username, privateReplySent, brandMention) {
  if (brandMention) {
    const opts = [
      `Just sent you a DM, it's ${brandMention}  ${username ? "@" + username : ""} 📩`,
      `It's ${brandMention}, Check your DMs! 💌`,
      `DM sent your way 🚀, It's ${brandMention}`,
      `Replied in your inbox, check ${brandMention} ✨`,
    ];
    const fallbackOpts = [
      `It's ${brandMention}  ${username ? "@" + username : ""} 📩`,
      `Check out ${brandMention} ✨`,
    ];
    return pick(privateReplySent ? opts : fallbackOpts).trim();
  }
  const opts = [
    `Just sent you a DM 📩`,
    `Check your DMs! 💌`,
    `DM sent your way 🚀`,
    `Replied in your inbox ✨`,
  ];
  const fallbackOpts = [
    `Check your DMs in a sec ✨`,
    `DM coming your way 🚀`,
  ];
  return pick(privateReplySent ? opts : fallbackOpts).trim();
}

async function processAccountComment(account, { commentId, username, mediaId }) {
  // Resolve the link: per-post override first, then account default. If
  // neither is set, this post is effectively un-configured — skip both the
  // DM and the public reply so the account doesn't engage on reels the
  // operator hasn't wired up yet.
  let link = null;
  if (mediaId) {
    try {
      const postLinks = await getPostLinkMap(account.id);
      const override = postLinks.get(String(mediaId));
      if (override) {
        link = override;
        console.log(`🔗 [${account.username}] using per-post link for media ${mediaId}`);
      }
    } catch (err) {
      console.error(`⚠️ [${account.username}] post_links lookup failed: ${err.message}`);
    }
  }
  if (!link) link = effectiveAppLink(account);
  if (!link) {
    console.log(`⏭️ [${account.username}] no link configured for media ${mediaId} — skipping DM and reply`);
    return;
  }

  let privateReplySent = false;
  if (account.dm_disabled) {
    console.log(`⏭️ [${account.username}] DMs disabled — public reply only`);
  } else {
    const message = buildAccountDM(username, link);
    try {
      await sendAccountPrivateReply(account, commentId, message);
      privateReplySent = true;
    } catch (err) {
      console.error(`⚠️ [${account.username}] DM failed, attempting public reply`);
    }
  }
  const reply = pickAccountPublicReply(username, privateReplySent, account.brand_mention);
  try {
    await replyAccountPublicly(account, commentId, reply);
  } catch (err) {
    console.error(
      `❌ [${account.username}] public reply failed:`,
      err.response?.status,
      JSON.stringify(err.response?.data || err.message)
    );
  }
}

async function sendAccountPrivateReply(account, commentId, text) {
  const url = `${GRAPH}/${account.id}/messages`;
  console.log(`🚀 [${account.username}] sending DM via: ${url}`);
  try {
    const { data } = await sendDMWithRetry(`[${account.username}] DM`, () =>
      axios.post(
        url,
        { recipient: { comment_id: commentId }, message: { text } },
        { params: { access_token: account.access_token } }
      )
    );
    console.log(`📨 [${account.username}] DM sent:`, JSON.stringify(data));
  } catch (err) {
    console.error(
      `💥 [${account.username}] DM FAILED:`,
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw err;
  }
}

async function replyAccountPublicly(account, commentId, message) {
  const url = `${GRAPH}/${commentId}/replies`;
  try {
    await axios.post(url, null, {
      params: { message, access_token: account.access_token },
    });
    console.log(`💬 [${account.username}] public reply posted`);
  } catch (err) {
    console.error(
      `⚠️ [${account.username}] public reply failed:`,
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
  }
}