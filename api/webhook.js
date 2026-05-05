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
  (name) => `Hey ${name}, thanks for dropping a comment!`,
  (name) => `${name}! Saw your comment 🙏`,
  (name) => `Heyy ${name} ✨`,
];

const acknowledgements = [
  (text) => `Really appreciate you taking the time to comment "${truncate(text)}".`,
  (text) => `Loved your comment — "${truncate(text)}" 💯`,
  () => `Thanks for the love on that post!`,
  () => `Glad the post resonated 🙌`,
  () => `Means a lot that you commented!`,
  () => `So glad you reached out 💛`,
];

const linkLines = [
  (link) => `Here's what you're looking for 👉 ${link}`,
  (link) => `Grab it here: ${link}`,
  (link) => `Check this out → ${link}`,
  (link) => `This is the link I think you'll want:\n${link}`,
  (link) => `All yours: ${link}`,
];

const closers = [
  `Let me know what you think!`,
  `Hope it helps 🙂`,
  `Reply here if you have any questions!`,
  `Curious to hear your thoughts 💭`,
  ``,
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const truncate = (s = "", n = 40) => (s.length > n ? s.slice(0, n) + "…" : s);

function buildPersonalDM({ username, commentText }) {
  const name = username ? `@${username}` : "there";
  const lines = [
    pick(greetings)(name),
    pick(acknowledgements)(commentText),
    pick(linkLines)(APP_LINK),
    pick(closers),
  ].filter(Boolean);
  return lines.join("\n\n");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    res.status(200).send("OK");
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
          if (fromId === IG_USER_ID) continue;

          console.log(`💬 ${username || fromId}: "${text}"`);

          const message = buildPersonalDM({ username, commentText: text });
          await sendPrivateReply(commentId, message);
          await replyPublicly(commentId, pickPublicReply(username));
        }
      }
    } catch (err) {
      console.error("Handler error:", err.response?.data || err.message);
    }
    return;
  }

  return res.status(405).send("Method Not Allowed");
}

function pickPublicReply(username) {
  const opts = [
    `Just sent you a DM ${username ? "@" + username : ""} 📩`,
    `Check your DMs! 💌`,
    `DM sent your way 🚀`,
    `Replied in your inbox ✨`,
    `${username ? "@" + username + " " : ""}slid into your DMs 😄`,
  ];
  return pick(opts).trim();
}

async function sendPrivateReply(commentId, text) {
  const url = `${GRAPH}/${IG_USER_ID}/messages`;
  await axios.post(
    url,
    { recipient: { comment_id: commentId }, message: { text } },
    { params: { access_token: IG_ACCESS_TOKEN } }
  );
  console.log("📨 DM sent");
}

async function replyPublicly(commentId, message) {
  const url = `${GRAPH}/${commentId}/replies`;
  await axios.post(url, null, {
    params: { message, access_token: IG_ACCESS_TOKEN },
  });
}