import { parse as parseISODuration, toSeconds } from "iso8601-duration";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json" with { type: "json" };
import { CATEGORY_MAP } from "./map.js";
import { getCategoryName } from "./map.js";
import { LANGUAGE_MAP } from "./map.js";
import { getLanguageName } from "./map.js";

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

      // Handle bare handle like /PoojaDutt (without @ or c/ prefix).
      // YouTube supports these URLs. Note: this can be exactly 11
      // characters long, the same length as a video ID (e.g. the real
      // handle "AmanManazir") — that's not actually ambiguous in
      // practice, since real YouTube video URLs never use a bare path
      // like this (always /watch?v=, youtu.be/, /shorts/, etc., which
      // are handled separately by parseVideoId), so there's no need to
      // exclude 11-char paths here.
      m = path.match(/^\/([^/]+)$/);
      if (m) {
        return await resolveHandle(m[1], ytFetch);
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
  // Allow dots, underscores, hyphens, alphanumerics, at least 8 chars.
  // Exclude pure 11‑character video IDs.
  if (/^[A-Za-z0-9_.-]{8,}$/.test(text) && !/^[A-Za-z0-9_-]{11}$/.test(text)) {
    return text;
  }
  try {
    const url = new URL(text);
    const lc = url.searchParams.get("lc") || url.searchParams.get("commentId");
    if (lc) return lc;
  } catch {
    // not a URL
  }
  return null;
}

export function parsePlaylistId(text) {
  text = (text || "").trim();
  // PL = regular playlist, UU = channel uploads, LL = liked videos,
  // FL = favorites (legacy), WL = watch later, RD = mix/radio
  if (/^[A-Za-z0-9_-]{13,}$/.test(text) && /^(PL|UU|LL|FL|WL|RD)/.test(text)) return text;
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

// Returns the total number of seconds represented by an ISO-8601 duration
// string (e.g. "PT4M13S"), or null if it can't be parsed. Used for sorting
// videos by duration, since the human-readable form isn't sortable.
export function durationToSeconds(isoDur) {
  if (!isoDur) return null;
  try {
    const secs = Math.floor(toSeconds(parseISODuration(isoDur)));
    return Number.isFinite(secs) ? secs : null;
  } catch {
    return null;
  }
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

// ── Number formatting ───────────────────────────────────────────────────

/**
 * Formats a count for display.
 * Values below 1000 are returned as-is (e.g. "N/A", "42").
 * Values >= 1000 get:
 *   - comma-separated full form  e.g. 1,000  10,000  1,234,567
 *   - short suffix form in brackets  e.g. (1K)  (10K)  (1.2M)  (2.8B)
 *
 * Non-numeric strings such as "N/A" are returned unchanged.
 */
export function fmtCount(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const full = n.toLocaleString("en-US");
  if (n < 1000) return full;

  let short;
  if (n >= 1_000_000_000) {
    short = (n / 1_000_000_000).toFixed(n >= 100_000_000_000 ? 0 : 1).replace(/\.0$/, "") + "B";
  } else if (n >= 1_000_000) {
    short = (n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  } else {
    short = (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  }

  return `${full} (${short})`;
}

// ── Keyword matching ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'on', 'at', 'to', 'in', 'with',
  'without', 'and', 'or', 'but', 'nor', 'yet', 'so', 'as', 'by'
]);

export function keywordMatches(fields, keyword, matchMode = "every") {
  if (!keyword) return false;
  const hay = Array.isArray(fields) ? fields.join(" ") : String(fields || "");
  const hayLower = hay.toLowerCase();

  // Split into tokens, filter out stop words and very short words
  let tokens = String(keyword || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  tokens = tokens.filter(token =>
    token.length >= 3 && !STOP_WORDS.has(token)
  );

  if (!tokens.length) return true; // Only stop words - match everything

  // Word-boundary match (with a trailing "es"/"s" allowance for simple
  // plurals) instead of a raw substring check — a plain `.includes(tok)`
  // would let "carol" match "carolina" or "carollo", which is how
  // unrelated results with the token merely embedded in another word were
  // sneaking through.
  const test = (tok) => {
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}(es|s)?\\b`, "i");
    return pattern.test(hayLower);
  };

  if (matchMode === "some") {
    return tokens.some(test);
  } else {
    return tokens.every(test);
  }
}

// In helpers.js
export function formatAvatarUrl(url) {
  if (!url) return null;
  // Replace any =sXX with =s88 (where XX is one or more digits)
  return url.replace(/=s\d+/, '=s88');
}

/**
 * `brandingSettings.image.bannerExternalUrl` is the original banner asset
 * (recommended upload size 2560x1440) served through Google's image CDN
 * with a size/crop instruction baked into the URL — and critically, that
 * instruction can itself contain more than one "=" (e.g.
 * "...=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj", where the
 * "1,0000..." after the second "=" is crop-region data, not a separate
 * param). YouTube defaults the width to a fairly small size, which is why
 * the banner can look soft even though a much higher-res version is
 * sitting behind the same image ID. To fix this, strip everything from the
 * FIRST "=" onward (removing both the old width and the crop instructions)
 * and append a large width request instead — the CDN serves back the
 * largest size it actually has if the requested width exceeds it, so
 * asking for 2560 always returns whichever is available, up to that cap.
 */
export function highResBannerUrl(bs) {
  const image = bs?.image || {};
  const ext = image.bannerExternalUrl;
  if (ext && ext.includes("=")) {
    return ext.replace(/=.*/, "=w2560");
  }
  if (ext) return `${ext}=w2560`;

  // Fallback: explicit presets, ordered by resolution (highest first).
  return (
    image.bannerTabletExtraHdImageUrl || // 2560x424
    image.bannerTvExtraHdImageUrl || // 2120x1192
    image.bannerTvHighImageUrl || // 1920x1080
    image.bannerTabletHdImageUrl || // 2276x377
    image.bannerMobileExtraHdImageUrl || // 1440x395
    image.bannerTvMediumImageUrl || // 1280x720
    image.bannerMobileHdImageUrl || // 1280x360
    image.bannerImageUrl || // 1060x175
    image.bannerTabletImageUrl || // 1707x283
    image.bannerMobileMediumHdImageUrl || // 960x263
    image.bannerTvImageUrl ||
    image.bannerTabletLowImageUrl ||
    image.bannerMobileImageUrl ||
    image.bannerTvLowImageUrl ||
    image.bannerMobileLowImageUrl ||
    null
  );
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

// ── Comment shaping ─────────────────────────────────────────────────────
//
// Shared by /api/comments and /api/all-comments so both map YouTube's
// commentThreads.list items into the same shape (and so replies embedded
// inline on the thread come out identical either way).
export function shapeCommentThread(thread, videoId) {
  const top = thread.snippet.topLevelComment;
  const sn = top.snippet;
  const replies = (thread.replies?.comments || []).map((reply) => {
    const rs = reply.snippet;
    return {
      commentId: reply.id,
      authorName: rs.authorDisplayName,
      authorChannelId: rs.authorChannelId?.value || "N/A",
      authorChannelUrl: rs.authorChannelUrl || null,
      authorProfileImageUrl: formatAvatarUrl(rs.authorProfileImageUrl) || null,
      likeCount: rs.likeCount ?? 0,
      publishedAt: fmtDatetimeAt(rs.publishedAt),
      updatedAt: fmtDatetimeAt(rs.updatedAt),
      textDisplay: rs.textDisplay || "",
      textOriginal: rs.textOriginal || "",
      publishedAtRaw: rs.publishedAt,
      videoId,
    };
  });
  return {
    commentId: top.id,
    authorName: sn.authorDisplayName,
    authorChannelId: sn.authorChannelId?.value || "N/A",
    authorChannelUrl: sn.authorChannelUrl || null,
    authorProfileImageUrl: formatAvatarUrl(sn.authorProfileImageUrl) || null,
    likeCount: sn.likeCount ?? 0,
    publishedAt: fmtDatetimeAt(sn.publishedAt),
    updatedAt: fmtDatetimeAt(sn.updatedAt),
    textDisplay: sn.textDisplay || "",
    textOriginal: sn.textOriginal || "",
    replyCount: thread.snippet.totalReplyCount ?? 0,
    replies,
    publishedAtRaw: sn.publishedAt,
    videoId,
  };
}

// ── Shorts detection via oEmbed ──────────────────────────────────────────
//
// YouTube's oEmbed endpoint (https://www.youtube.com/oembed) always reports
// a landscape (width > height) player size when called with a regular
// /watch?v= URL, even for videos that are actually Shorts — so that alone
// can't tell Shorts apart from standard/live videos. Calling oEmbed with the
// /shorts/<id> URL form instead is what actually flips the reported
// dimensions: real Shorts come back with height > width (their true
// portrait player), while standard/live videos either fail to resolve via
// that URL form or still come back landscape. So: a video counts as a Short
// only when the /shorts/ oEmbed call succeeds AND reports height > width.
// Anything else (an error, or width >= height) is treated as not-a-Short,
// and the existing liveStreamingDetails-based check still takes priority
// for classifying live streams/premieres.
const OEMBED_TIMEOUT_MS = 4000;

export async function fetchIsShortViaOEmbed(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/shorts/${videoId}`
    )}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return false;
    const data = await resp.json();
    const width = Number(data.width);
    const height = Number(data.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    return height > width;
  } catch {
    // Network error, timeout, or non-JSON response — default to "not a Short"
    // rather than letting one flaky lookup break the whole list.
    return false;
  }
}

// ── Video shaping ───────────────────────────────────────────────────────

export function shapeVideo(item, idOverride) {
  const sid = item.snippet;
  const cdet = item.contentDetails || {};
  const stat = item.statistics || {};
  const vid = idOverride || (typeof item.id === "string" ? item.id : item.id?.videoId || "");
  const liveDetails = item.liveStreamingDetails || {};

  return {
    videoId: vid,
    videoUrl: `https://www.youtube.com/watch?v=${vid}`,
    title: sid.title,
    channelId: sid.channelId,
    channelTitle: sid.channelTitle,
    uploadDate: fmtDatetime(sid.publishedAt),
    duration: cdet.duration ? fmtDuration(cdet.duration) : "N/A",
    durationSeconds: durationToSeconds(cdet.duration),
    likes: stat.likeCount ?? "N/A",
    views: stat.viewCount ?? "N/A",
    comments: stat.commentCount ?? "N/A",
    thumbnail:
      sid.thumbnails?.maxres?.url ||
      sid.thumbnails?.standard?.url ||
      sid.thumbnails?.high?.url ||
      sid.thumbnails?.medium?.url ||
      sid.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`,
    description: (sid.description || "").trim(),
    tags: Array.isArray(sid.tags) ? sid.tags : [],
    defaultLanguage: getLanguageName(sid.defaultLanguage) || "N/A",
    defaultAudioLanguage: getLanguageName(sid.defaultAudioLanguage) || "N/A",
    categoryId: sid.categoryId || null,
    categoryName: getCategoryName(sid.categoryId) || null,
    regionRestriction: cdet.regionRestriction ? {
      ...cdet.regionRestriction,
      blocked: cdet.regionRestriction.blocked?.map(fmtCountry) || []
    } : null,
    publishedAtRaw: sid.publishedAt,
    scheduledStartTime: liveDetails.scheduledStartTime ? fmtDatetime(liveDetails.scheduledStartTime) : null,
    actualStartTime: liveDetails.actualStartTime ? fmtDatetime(liveDetails.actualStartTime) : null,
    actualEndTime: liveDetails.actualEndTime ? fmtDatetime(liveDetails.actualEndTime) : null,
    liveBroadcastContent: sid.liveBroadcastContent || "none",
    // Filled in afterwards by attachShortsFlags() via an oEmbed lookup — a
    // video is never both live and a Short, so this starts false and is
    // only ever set true for non-live videos.
    isShort: false,
  };
}