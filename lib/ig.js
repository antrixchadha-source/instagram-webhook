// Thin wrappers around the bits of the IG Graph API the admin endpoints need
// when adding a new account.
import axios from "axios";

const GRAPH = "https://graph.instagram.com/v25.0";

export async function whoami(accessToken) {
  const { data } = await axios.get(`${GRAPH}/me`, {
    params: { fields: "id,username,account_type", access_token: accessToken },
  });
  return data;
}

export async function subscribeToComments(igUserId, accessToken) {
  // Idempotent on Meta's side — re-subscribing while already subscribed is a no-op.
  const { data } = await axios.post(`${GRAPH}/${igUserId}/subscribed_apps`, null, {
    params: { subscribed_fields: "comments", access_token: accessToken },
  });
  return data;
}

export async function fetchRecentMedia(igUserId, accessToken, limit = 25) {
  const { data } = await axios.get(`${GRAPH}/${igUserId}/media`, {
    params: {
      fields: "id,caption,media_type,permalink,timestamp,thumbnail_url,media_url",
      limit,
      access_token: accessToken,
    },
  });
  return data.data || [];
}
