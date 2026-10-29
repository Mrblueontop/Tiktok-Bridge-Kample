// TikTok sound bridge: GET /sound/:id  ->  { musicInfo: { music, author } }
// Requires Node 18+. No dependencies.
const http = require("http");

const PORT = process.env.PORT || 3000;
const KEY = process.env.BRIDGE_KEY || "";
const PROXY_NOTE = "If TikTok blocks Railway's IP, route fetches through a residential proxy.";

if (!KEY) {
  console.error("BRIDGE_KEY is not set. Refusing to start without auth.");
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// tiny in-memory cache so repeat lookups don't hammer TikTok
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function fetchSound(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const res = await fetch(`https://www.tiktok.com/music/original-sound-${id}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error("tiktok_status_" + res.status);
  const html = await res.text();

  const m = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("no_rehydration_data (" + PROXY_NOTE + ")");

  const scope = JSON.parse(m[1]).__DEFAULT_SCOPE__ || {};
  const info = scope["webapp.music-detail"] && scope["webapp.music-detail"].musicInfo;
  if (!info || !info.music) throw new Error("sound_not_found");

  cache.set(id, { at: Date.now(), data: { musicInfo: info } });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return { musicInfo: info };
}

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/health") return send(res, 200, { ok: true });

    if (req.headers.authorization !== "Bearer " + KEY)
      return send(res, 401, { error: "unauthorized" });

    const m = /^\/sound\/(\d{10,20})$/.exec(url.pathname);
    if (req.method !== "GET" || !m) return send(res, 404, { error: "not_found" });

    try {
      send(res, 200, await fetchSound(m[1]));
    } catch (err) {
      console.error("bridge_error:", err.message);
      send(res, err.message === "sound_not_found" ? 404 : 502, { error: err.message });
    }
  })
  .listen(PORT, () => console.log("tiktok bridge listening on " + PORT));
