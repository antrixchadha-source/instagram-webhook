import { listAccounts, effectiveAppLink } from "../../lib/accounts.js";
import { listPostLinks, upsertPostLink, deletePostLink } from "../../lib/post_links.js";
import { fetchRecentMedia } from "../../lib/ig.js";
import { checkBasicAuth, sendAuthChallenge } from "../../lib/auth.js";

async function findAccount(accountId) {
  const all = await listAccounts();
  return all.find((a) => String(a.id) === String(accountId));
}

export default async function handler(req, res) {
  if (!checkBasicAuth(req)) return sendAuthChallenge(res);
  try {
    if (req.method === "GET") {
      const accountId = req.query.account_id;
      if (!accountId) return res.status(400).send("account_id query param required");
      const account = await findAccount(accountId);
      if (!account) return res.status(404).send("account not found");

      // Currently saved per-post overrides.
      const links = await listPostLinks(accountId);
      const linkMap = Object.fromEntries(links.map((l) => [l.media_id, l.link]));

      // Recent posts from Graph API so the UI can show captions + thumbnails.
      let media = [];
      let mediaError = null;
      try {
        media = await fetchRecentMedia(account.id, account.access_token, 25);
      } catch (err) {
        mediaError = err.response?.data?.error?.message || err.message;
      }

      return res.status(200).json({
        account: { id: account.id, username: account.username, app_link: effectiveAppLink(account) },
        links: linkMap,
        media,
        media_error: mediaError,
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const { account_id, media_id, link } = req.body || {};
      if (!account_id || !media_id || !link) {
        return res.status(400).send("account_id, media_id, and link are required");
      }
      const saved = await upsertPostLink({ account_id, media_id, link });
      return res.status(200).json(saved);
    }

    if (req.method === "DELETE") {
      const account_id = req.query.account_id || req.body?.account_id;
      const media_id = req.query.media_id || req.body?.media_id;
      if (!account_id || !media_id) {
        return res.status(400).send("account_id and media_id required");
      }
      await deletePostLink({ account_id, media_id });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).send("Method not allowed");
  } catch (err) {
    console.error("post-links handler failed:", err.message);
    return res.status(500).send(err.message);
  }
}
