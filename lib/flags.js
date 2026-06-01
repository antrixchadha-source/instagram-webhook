// Toggle flags backed by Upstash Redis (via Vercel Marketplace). When the
// Redis connection isn't configured, reads fall back to the legacy env-var
// values so the webhook keeps working unchanged.
import { Redis } from "@upstash/redis";

const FLAGS_KEY = "webhook:flags";

const truthy = (v) => {
  const s = (v ?? "").trim().toLowerCase();
  return !!s && s !== "false" && s !== "0";
};

const ENV_DEFAULTS = () => ({
  riddhi_paused: truthy(process.env.IG_PAUSED),
  riddhi_dm_disabled: truthy(process.env.IG_DM_DISABLED),
  hershey_paused: truthy(process.env.HERSHEY_PAUSED),
  hershey_dm_disabled: truthy(process.env.HERSHEY_DM_DISABLED),
});

export const VALID_FLAGS = new Set([
  "riddhi_paused",
  "riddhi_dm_disabled",
  "hershey_paused",
  "hershey_dm_disabled",
]);

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  _redis = Redis.fromEnv();
  return _redis;
}

export async function readFlags() {
  const defaults = ENV_DEFAULTS();
  const redis = getRedis();
  if (!redis) return defaults;
  try {
    const stored = (await redis.get(FLAGS_KEY)) || {};
    return { ...defaults, ...stored };
  } catch (err) {
    console.error("⚠️ flags read failed, using env defaults:", err.message);
    return defaults;
  }
}

export async function writeFlag(key, value) {
  if (!VALID_FLAGS.has(key)) {
    throw new Error(`unknown flag: ${key}`);
  }
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis not configured — connect Upstash via Vercel Marketplace first");
  }
  const current = await readFlags();
  current[key] = !!value;
  await redis.set(FLAGS_KEY, current);
  return current;
}
