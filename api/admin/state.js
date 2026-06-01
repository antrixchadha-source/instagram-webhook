import { readFlags } from "../../lib/flags.js";
import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  const flags = await readFlags();
  return res.status(200).json(flags);
}
