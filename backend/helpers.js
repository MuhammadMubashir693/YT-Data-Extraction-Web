import { parse as parseISODuration, toSeconds } from "iso8601-duration";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(en);

// ── ID parsers ───────────────────────────────────────────────────────────

export function parseVideoId(text) {
  text = (text || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;

  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;

    if (host === "youtu.be") {
      const vid = path.replace(/^\//, "").split("/")[0].split("?")[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(vid)) return vid;
    }

    if (["youtube.com", "music.youtube.com", "m.youtube.com"].includes(host)) {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

      const m = path.match(/^\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    // not a URL
  }
  return null;
}

export async function parseChannelId(text, ytFetch) {
  text = (text || "").trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(text)) return text;

  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "");

    if (["youtube.com", "m.youtube.com"].includes(host)) {
      let m = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/);
      if (m) return m[1];

      m = path.match(/^\/(?:@([^/]+)|c\/([^/]+)|user\/([^/]+))$/);
      if (m) {
        const handle = m[1] || m[2] || m[3];
        return await resolveHandle(handle, ytFetch);
      }
    }
  } catch {
    // not a URL
  }

  if (/^@?[\w.-]{3,50}$/.test(text)) {
    const handle = text.replace(/^@/, "");
    return await resolveHandle(handle, ytFetch);
  }
  return null;
}

async function resolveHandle(handle, ytFetch) {
  try {
    let resp = await ytFetch("channels", { part: "id", forHandle: handle });
    if (resp.items?.length) return resp.items[0].id;

    resp = await ytFetch("channels", { part: "id", forUsername: handle });
    if (resp.items?.length) return resp.items[0].id;
  } catch {
    // ignore
  }
  return null;
}

export function parseCommentId(text) {
  text = (text || "").trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(text) && !/^[A-Za-z0-9_-]{11}$/.test(text)) {
    return text;
  }
  try {
    const url = new URL(text);
    const lc = url.searchParams.get("lc");
    if (lc) return lc;
  } catch {
    // ignore
  }
  return null;
}

export function parsePlaylistId(text) {
  text = (text || "").trim();
  if (/^[A-Za-z0-9_-]{13,}$/.test(text) && text.startsWith("PL")) return text;
  try {
    const url = new URL(text);
    const list = url.searchParams.get("list");
    if (list) return list;
  } catch {
    // ignore
  }
  return null;
}

// ── Formatting helpers ──────────────────────────────────────────────────

export function fmtDatetime(isoStr) {
  const dt = new Date(isoStr);
  return dt.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

export function fmtDatetimeAt(isoStr) {
  const dt = new Date(isoStr);
  const date = dt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = dt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${date} at ${time} UTC`;
}

export function fmtDuration(isoDur) {
  let total;
  try {
    total = Math.floor(toSeconds(parseISODuration(isoDur)));
  } catch {
    return "0 seconds";
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  if (seconds || parts.length === 0) {
    parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);
  }
  return parts.join(" ");
}

export function fmtCountry(code) {
  if (!code) return "Country not available";
  const name = countries.getName(code.toUpperCase(), "en");
  return name || "Country not available";
}

// ── Keyword matching ────────────────────────────────────────────────────

export function keywordMatches(fields, keyword) {
  if (!keyword) return false;
  const hay = Array.isArray(fields) ? fields.join(" ") : String(fields || "");
  const hayLower = hay.toLowerCase();

  const tokens = String(keyword || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  return tokens.every((tok) => {
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}(es|s)?\\b`, "i");
    return pattern.test(hayLower);
  });
}

// ── Per-field keyword matching ──────────────────────────────────────────

/**
 * Checks keyword matches per individual field.
 * Each of title/description/channel is only checked if its keyword is non-empty.
 * All provided (non-empty) keywords must match their respective field.
 * Returns true if at least one keyword is provided and all provided ones match.
 */
export function keywordMatchesPerField(snippet, { keywordTitle, keywordDescription, keywordChannel }) {
  const checks = [
    { keyword: keywordTitle, field: snippet.title },
    { keyword: keywordDescription, field: snippet.description },
    { keyword: keywordChannel, field: snippet.channelTitle },
  ].filter(({ keyword }) => keyword && keyword.trim());

  if (!checks.length) return true; // nothing to filter on

  return checks.every(({ keyword, field }) => keywordMatches([field], keyword));
}

// ── Video shaping ───────────────────────────────────────────────────────

export function shapeVideo(item, idOverride) {
  const sid = item.snippet;
  const cdet = item.contentDetails || {};
  const stat = item.statistics || {};
  const vid = idOverride || (typeof item.id === "string" ? item.id : item.id?.videoId || "");

  return {
    videoId: vid,
    videoUrl: `https://www.youtube.com/watch?v=${vid}`,
    title: sid.title,
    channelId: sid.channelId,
    channelTitle: sid.channelTitle,
    uploadDate: fmtDatetime(sid.publishedAt),
    duration: cdet.duration ? fmtDuration(cdet.duration) : "N/A",
    likes: stat.likeCount ?? "N/A",
    views: stat.viewCount ?? "N/A",
    comments: stat.commentCount ?? "N/A",
    thumbnail:
      sid.thumbnails?.standard?.url ||
      sid.thumbnails?.high?.url ||
      sid.thumbnails?.medium?.url ||
      sid.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${vid}/sddefault.jpg`,
    description: (sid.description || "").trim(),
    publishedAtRaw: sid.publishedAt,
  };
}