// File: /api/webhook.js
import axios from "axios";
import { waitUntil } from "@vercel/functions";
import { getAccountMap } from "../lib/accounts.js";

const { VERIFY_TOKEN, WEBHOOK_PAUSED } = process.env;
const GRAPH = "https://graph.instagram.com/v25.0";

const truthy = (v) => {
  const s = (v ?? "").trim().toLowerCase();
  return !!s && s !== "false" && s !== "0";
};

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
  (link) => `This is the link:\n${link}`,
];

const closers = [`Hope it helps 🙂`, `Let me know what you think!`, ``];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildPersonalDM({ username, appLink }) {
  const name = username ? `@${username}` : "there";
  return [pick(greetings)(name), pick(linkLines)(appLink), pick(closers)]
    .filter(Boolean)
    .join("\n\n");
}

function pickPublicReply({ username, privateReplySent, brandMention }) {
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
    if (truthy(WEBHOOK_PAUSED)) {
      console.log("⏸️ WEBHOOK_PAUSED — acking without processing");
      return res.status(200).send("OK");
    }

    console.log("📥 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));

    let accountMap;
    try {
      accountMap = await getAccountMap();
    } catch (err) {
      console.error("⚠️ accounts read failed:", err.message);
      return res.status(200).send("OK");
    }

    const entries = req.body?.entry || [];
    for (const entry of entries) {
      const ownerId = entry?.id;
      const account = accountMap.get(ownerId);
      if (!account) {
        console.log(`⏭️ no account configured for entry.id=${ownerId}`);
        continue;
      }
      if (account.paused) {
        console.log(`⏸️ [${account.username}] paused, skipping`);
        continue;
      }

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
          console.log(`⏭️ [${account.username}] reply comment, skipping`);
          continue;
        }
        if (fromId === ownerId) {
          console.log(`⏭️ [${account.username}] own comment, skipping`);
          continue;
        }

        console.log(`💬 [${account.username}] ${username || fromId}: "${text}"`);
        waitUntil(processComment(account, { commentId, username }));
      }
    }

    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

async function processComment(account, { commentId, username }) {
  let privateReplySent = false;
  if (account.dm_disabled) {
    console.log(`⏭️ [${account.username}] DMs disabled — public reply only`);
  } else {
    const message = buildPersonalDM({ username, appLink: account.app_link });
    try {
      await sendPrivateReply(account, commentId, message);
      privateReplySent = true;
    } catch (err) {
      console.error(`⚠️ [${account.username}] DM failed, attempting public reply`);
    }
  }
  const reply = pickPublicReply({
    username,
    privateReplySent,
    brandMention: account.brand_mention,
  });
  try {
    await replyPublicly(account, commentId, reply);
  } catch (err) {
    console.error(
      `❌ [${account.username}] public reply failed:`,
      err.response?.status,
      JSON.stringify(err.response?.data || err.message)
    );
  }
}

async function sendPrivateReply(account, commentId, text) {
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

async function replyPublicly(account, commentId, message) {
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
