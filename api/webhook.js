// File: /api/webhook.js
import axios from "axios";
import { waitUntil } from "@vercel/functions";

const {
  VERIFY_TOKEN,
  IG_ACCESS_TOKEN,
  IG_USER_ID,
  APP_LINK,
  WEBHOOK_PAUSED,
  IG_PAUSED,
  HERSHEY_USER_ID,
  HERSHEY_TOKEN,
  HERSHEY_APP_LINK,
  HERSHEY_PAUSED,
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

const closers = [
  `Hope it helps 🙂`,
  `Let me know what you think!`,
  ``,
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildPersonalDM({ username }) {
  const name = username ? `@${username}` : "there";
  const lines = [
    pick(greetings)(name),
    pick(linkLines)(APP_LINK),
    pick(closers),
  ].filter(Boolean);
  return lines.join("\n\n");
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
    // Kill-switch: set WEBHOOK_PAUSED to any non-empty value in Vercel env
    // to silently ack incoming events without sending DMs or replies.
    const pausedRaw = (WEBHOOK_PAUSED ?? "").trim();
    console.log(`🔧 WEBHOOK_PAUSED=${JSON.stringify(WEBHOOK_PAUSED)} (trimmed=${JSON.stringify(pausedRaw)})`);
    if (pausedRaw && pausedRaw.toLowerCase() !== "false" && pausedRaw !== "0") {
      console.log("⏸️ paused — acking without processing");
      return res.status(200).send("OK");
    }

    console.log("📥 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));

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

        // Route to the right account handler. Per-account pause flags
        // override only that account; WEBHOOK_PAUSED above is global.
        if (ownerId === IG_USER_ID) {
          if (truthy(IG_PAUSED)) {
            console.log("⏸️ IG_PAUSED — skipping riddhi comment");
            continue;
          }
          waitUntil(processComment({ commentId, username }));
        } else if (ownerId === HERSHEY_USER_ID) {
          if (truthy(HERSHEY_PAUSED)) {
            console.log("⏸️ HERSHEY_PAUSED — skipping hershey comment");
            continue;
          }
          waitUntil(processHersheyComment({ commentId, username }));
        } else {
          console.log(`⏭️ no handler for owner ${ownerId}`);
        }
      }
    }

    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

async function processComment({ commentId, username }) {
  const message = buildPersonalDM({ username });
  let privateReplySent = false;
  try {
    await sendPrivateReply(commentId, message);
    privateReplySent = true;
  } catch (err) {
    console.error("⚠️ DM failed, will attempt public reply if possible");
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
  return [pick(greetings)(name), pick(linkLines)(HERSHEY_APP_LINK), pick(closers)]
    .filter(Boolean)
    .join("\n\n");
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

async function processHersheyComment({ commentId, username }) {
  const message = buildHersheyDM({ username });
  let privateReplySent = false;
  try {
    await sendHersheyPrivateReply(commentId, message);
    privateReplySent = true;
  } catch (err) {
    console.error("⚠️ [hershey] DM failed, attempting public reply");
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