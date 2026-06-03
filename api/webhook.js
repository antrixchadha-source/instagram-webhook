// File: /api/webhook.js
import axios from "axios";
import { waitUntil } from "@vercel/functions";
import { readFlags } from "../lib/flags.js";
import { getAccountMap } from "../lib/accounts.js";
import { getPostLinkMap } from "../lib/post_links.js";

const {
  VERIFY_TOKEN,
  IG_ACCESS_TOKEN,
  IG_USER_ID,
  APP_LINK,
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

function buildPersonalDM({ username }) {
  const name = username ? `@${username}` : "there";
  return [pick(greetings)(name), pick(linkLines)(APP_LINK)].join("\n\n");
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
        if (fromId === IG_USER_ID || fromId === ownerId) {
          console.log("⏭️ Own comment, skipping");
          continue;
        }

        console.log(`💬 ${username || fromId}: "${text}"`);

        // Route to the right account handler.
        if (ownerId === IG_USER_ID) {
          if (flags.riddhi_paused) {
            console.log("⏸️ riddhi paused — skipping");
            continue;
          }
          waitUntil(processComment({ commentId, username, skipDM: flags.riddhi_dm_disabled }));
        } else if (ownerId === HERSHEY_USER_ID) {
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

async function processComment({ commentId, username, skipDM }) {
  let privateReplySent = false;
  if (skipDM) {
    console.log("⏭️ riddhi DMs disabled — public reply only");
  } else {
    const message = buildPersonalDM({ username });
    try {
      await sendPrivateReply(commentId, message);
      privateReplySent = true;
    } catch (err) {
      console.error("⚠️ DM failed, will attempt public reply if possible");
    }
  }
  try {
    await replyPublicly(commentId, pickPublicReply(username, privateReplySent));
  } catch (err) {
    console.error("❌ Public reply failed:", err.response?.status, JSON.stringify(err.response?.data || err.message));
  }
}

function pickPublicReply(username, private_reply_sent) {
  const opts = [
    `Just sent you a DM, it's @glide.xyz  ${username ? "@" + username : ""} 📩`,
    `It's @glide.xyz ,Check your DMs! 💌`,
    `DM sent your way 🚀, It's @glide.xyz `,
    `Replied in your inbox, check @glide.xyz ✨`,
  ];
  const fallbackOpts = [
    `It's @glide.xyz  ${username ? "@" + username : ""} 📩`,
    `Check out @glide.xyz ✨`,
  ];
  if (private_reply_sent) {
    return pick(opts).trim();
  }
  return pick(fallbackOpts).trim();
}

async function sendPrivateReply(commentId, text) {
  const url = `${GRAPH}/${IG_USER_ID}/messages`;
  console.log("🚀 Sending DM via:", url);
  try {
    const { data } = await axios.post(
      url,
      { recipient: { comment_id: commentId }, message: { text } },
      { params: { access_token: IG_ACCESS_TOKEN } }
    );
    console.log("📨 DM sent successfully:", JSON.stringify(data));
  } catch (err) {
    console.error("💥 DM send FAILED:", err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function replyPublicly(commentId, message) {
  const url = `${GRAPH}/${commentId}/replies`;
  try {
    await axios.post(url, null, {
      params: { message, access_token: IG_ACCESS_TOKEN },
    });
    console.log("💬 Public reply posted");
  } catch (err) {
    console.error("⚠️ Public reply failed:", err.response?.status, JSON.stringify(err.response?.data));
    // Don't throw — public reply is optional
  }
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
    const { data } = await axios.post(
      url,
      { recipient: { comment_id: commentId }, message: { text } },
      { params: { access_token: HERSHEY_TOKEN } }
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
  if (!link && account.app_link) link = account.app_link;
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
    const { data } = await axios.post(
      url,
      { recipient: { comment_id: commentId }, message: { text } },
      { params: { access_token: account.access_token } }
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