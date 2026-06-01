import { writeFlag, VALID_FLAGS } from "../../lib/flags.js";
import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const { key, value } = req.body || {};
  if (!VALID_FLAGS.has(key)) return res.status(400).send(`Unknown flag: ${key}`);
  try {
    const updated = await writeFlag(key, !!value);
    return res.status(200).json(updated);
  } catch (err) {
    console.error("toggle failed:", err.message);
    return res.status(500).send(err.message);
  }
}
