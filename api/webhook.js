// File: /api/webhook.js
import axios from "axios";

const {
  VERIFY_TOKEN,
  IG_ACCESS_TOKEN,
  IG_USER_ID,
  APP_LINK,
} = process.env;

const GRAPH = "https://graph.instagram.com/v23.0";

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
    console.log("📥 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));

    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          if (change.field !== "comments") continue;

          const c = change.value;
          const commentId = c.id;
          const fromId = c.from?.id;
          const username = c.from?.username;
          const text = c.text || "";

          if (!commentId) {
            console.error("❌ No commentId in payload");
            continue;
          }

          // Skip our own comments to avoid loops
          if (fromId === IG_USER_ID) {
            console.log("⏭️ Own comment, skipping");
            continue;
          }

          console.log(`💬 ${username || fromId}: "${text}"`);

          const message = buildPersonalDM({ username });
          await sendPrivateReply(commentId, message);
          await replyPublicly(commentId, pickPublicReply(username));
        }
      }
    } catch (err) {
      console.error("❌ Handler error:", err.response?.status, JSON.stringify(err.response?.data || err.message));
    }

    // Respond AFTER all work is done (key fix!)
    return res.status(200).send("OK");
  }

  return res.status(405).send("Method Not Allowed");
}

function pickPublicReply(username) {
  const opts = [
    `Just sent you a DM, it's @glide.xyz  ${username ? "@" + username : ""} 📩`,
    `It's @glide.xyz ,ALso Check your DMs! 💌`,
    `DM sent your way 🚀, It's @glide.xyz `,
    `Replied in your inbox, check @glide.xyz ✨`,
  ];
  return pick(opts).trim();
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