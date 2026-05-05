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
];

const linkLines = [
  (link) => `Here's what you're looking for 👉 ${link}`,
  (link) => `Grab it here: ${link}`,
  (link) => `Check this out → ${link}`,
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildPersonalDM({ username }) {
  const name = username ? `@${username}` : "there";
  return `${pick(greetings)(name)}\n\n${pick(linkLines)(APP_LINK)}`;
}

export default async function handler(req, res) {
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

  if (req.method === "POST") {
    res.status(200).send("OK");

    // Log the entire incoming payload so we can see the structure
    console.log("📥 RAW PAYLOAD:", JSON.stringify(req.body, null, 2));
    console.log("🔑 ENV CHECK:", {
      hasToken: !!IG_ACCESS_TOKEN,
      tokenStart: IG_ACCESS_TOKEN?.slice(0, 10),
      userId: IG_USER_ID,
      hasAppLink: !!APP_LINK,
    });

    try {
      const entries = req.body?.entry || [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          if (change.field !== "comments") {
            console.log("⏭️ Skipping field:", change.field);
            continue;
          }

          const c = change.value;
          const commentId = c.id;
          const fromId = c.from?.id;
          const username = c.from?.username;
          const text = c.text || "";

          console.log("📋 Parsed:", { commentId, fromId, username, text });

          if (!commentId) {
            console.error("❌ No commentId in payload!");
            continue;
          }

          if (fromId === IG_USER_ID) {
            console.log("⏭️ Skipping own comment");
            continue;
          }

          const message = buildPersonalDM({ username });
          console.log("✉️ Built message:", message);

          await sendPrivateReply(commentId, message);
        }
      }
    } catch (err) {
      console.error("❌ Handler error:", err.response?.status, err.response?.data || err.message);
    }
    return;
  }

  return res.status(405).send("Method Not Allowed");
}

async function sendPrivateReply(commentId, text) {
  const url = `${GRAPH}/${IG_USER_ID}/messages`;
  console.log("🚀 Calling:", url);
  try {
    const { data } = await axios.post(
      url,
      { recipient: { comment_id: commentId }, message: { text } },
      { params: { access_token: IG_ACCESS_TOKEN } }
    );
    console.log("📨 DM sent successfully:", data);
  } catch (err) {
    console.error("💥 DM send FAILED:", err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}