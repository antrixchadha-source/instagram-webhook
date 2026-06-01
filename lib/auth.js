// Minimal HTTP Basic Auth gate for the admin endpoints. Username is ignored;
// only ADMIN_PASSWORD env var matters.
export function checkBasicAuth(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return false;
    return decoded.slice(idx + 1) === expected;
  } catch {
    return false;
  }
}

export function sendAuthChallenge(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="admin", charset="UTF-8"');
  return res.status(401).send("Authentication required");
}
