import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { MongoClient } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseVideoId,
  parseChannelId,
  parseCommentId,
  parsePlaylistId,
  fmtDatetime,
  fmtDatetimeAt,
  fmtCountry,
  keywordMatches,
  keywordMatchesPerField,
  shapeVideo,
  durationToSeconds,
} from "./helpers.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.YT_API_KEY;
const PORT = process.env.PORT || 5000;
const BASE = "https://www.googleapis.com/youtube/v3";
const MONGO_USER = process.env.MONGO_USER || "admin";
const MONGO_PASS = process.env.MONGO_PASS || "mongo123";
const MONGO_HOST = process.env.MONGO_HOST || "localhost";
const MONGO_PORT = process.env.MONGO_PORT || "27017";
const MONGO_DB = process.env.MONGO_DB || "yt-data-web";
const MONGO_COLL = process.env.MONGO_COLL || "yt-channels";
const MONGO_URI = `mongodb://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASS)}@${MONGO_HOST}:${MONGO_PORT}/?authSource=admin`;

const mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
let channelCollection = null;

async function initMongo() {
  try {
    await mongoClient.connect();
    channelCollection = mongoClient.db(MONGO_DB).collection(MONGO_COLL);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Could not connect to MongoDB:", err.message);
  }
}

await initMongo();

function getChannelCollection() {
  if (!channelCollection) {
    throw new Error("MongoDB is not connected");
  }
  return channelCollection;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
console.log("Swagger UI available at http://localhost:5000/api-docs");

const PAGINATION_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ytFetchWithPaginationDelay(resource, params, pageNumber = 0) {
  if (pageNumber > 0) {
    await sleep(PAGINATION_DELAY_MS);
  }
  return ytFetch(resource, params);
}

// ── Generic in-memory response cache ─────────────────────────────────────
//
// A handful of endpoints wrap expensive, multi-call YouTube API work
// (paging through playlistItems/search/comments, then videos.list for
// details) behind a single request. Repeat requests for the same underlying
// resource — revisiting a channel, changing a sort dropdown, re-opening a
// video already looked at — shouldn't re-run all of that work when the
// underlying data is very unlikely to have changed in the meantime. Each
// cache below is a small LRU-ish TTL cache: keyed by whatever uniquely
// identifies the request (an ID, or an ID + the filter params that affect
// which YouTube calls get made), holding whatever we'd otherwise recompute.
// Sort order is intentionally excluded from cache keys — sorting is cheap
// and happens in-memory after a cache hit, same as the original playlist
// cache this was generalized from.

function createCache({ ttlMs, maxEntries }) {
  const store = new Map(); // key -> { value, expiresAt }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    // Refresh recency so frequently-hit keys survive eviction longer.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    if (store.size >= maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function del(key) {
    store.delete(key);
  }

  return { get, set, del };
}

// playlistId -> { playlistInfo, items } — full assembled playlist contents.
const playlistCache = createCache({ ttlMs: 10 * 60 * 1000, maxEntries: 50 });

// resolved channelId -> shaped channel details object (Part 3).
const channelCache = createCache({ ttlMs: 10 * 60 * 1000, maxEntries: 100 });

// channelId -> { channelId, playlists } — pages through every playlist the
// channel has, so a cache hit skips a potentially large number of sequential
// playlists.list calls entirely.
const channelPlaylistsCache = createCache({ ttlMs: 10 * 60 * 1000, maxEntries: 50 });

// videoId -> shaped video details object (Part 1), including the resolved
// channel thumbnail (itself an extra API call on a miss).
const videoCache = createCache({ ttlMs: 10 * 60 * 1000, maxEntries: 200 });

// `${channelId}:${count}:${pageToken}` -> { videos, uploadsPlaylistId, nextPageToken, prevPageToken }
const channelLatestVideosCache = createCache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });

// `${videoId}:${apiOrder}:${pageToken}:${maxResults}` -> { threads, totalCommentCount, nextPageToken }
// Keyed on API-affecting params only; keyword/date filtering and thread sort
// happen after the cache lookup so those can still change per request.
const commentsCache = createCache({ ttlMs: 3 * 60 * 1000, maxEntries: 100 });

// Search-style endpoints (channel-videos, search-videos, search-channels,
// search-playlists) all follow the same shape: page through `search`,
// batch-fetch full details, then filter. That whole pipeline is cached
// keyed on every param that affects it (everything except `sort`), so
// re-sorting existing results is instant instead of re-querying YouTube.
const channelVideosCache = createCache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });
const searchVideosCache = createCache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });
const searchChannelsCache = createCache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });
const searchPlaylistsCache = createCache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });

function cacheKey(parts) {
  return JSON.stringify(parts);
}

/**
 * @swagger
 * /api/proxy-image:
 *   get:
 *     summary: Proxy an image URL to avoid CORS
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *         description: Image URL
 *     responses:
 *       200:
 *         description: Image stream
 *       400:
 *         description: Missing url
 *       502:
 *         description: Proxy error
 */

app.get("/api/proxy-image", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: "Missing url query parameter." });
  }
  try {
    const response = await axios.get(url, {
      responseType: "stream",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; ImageProxy/1.0)",
      },
      timeout: 10000,
    });
    res.setHeader("content-type", response.headers["content-type"] || "application/octet-stream");
    response.data.pipe(res);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: err.message || "Could not proxy photo." });
  }
});

if (!API_KEY) {
  console.warn("WARNING: YT_API_KEY is not set. Add it to backend/.env");
}

// Helper to call the YouTube Data API
async function ytFetch(resource, params) {
  const maxRetries = 3;
  const backoff = (attempt) => 250 * Math.pow(2, attempt);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const resp = await axios.get(`${BASE}/${resource}`, {
        params: { ...params, key: API_KEY },
      });
      return resp.data;
    } catch (err) {
      const status = err?.response?.status;
      const isQuota = isQuotaError(err);
      const shouldRetry = !isQuota && (status === 429 || status === 500 || status === 503);
      if (attempt === maxRetries || !shouldRetry) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, backoff(attempt)));
    }
  }
}

function isQuotaError(err) {
  const errors = err?.response?.data?.error?.errors;
  if (Array.isArray(errors)) {
    return errors.some((e) =>
      ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(e.reason)
    );
  }
  const msg = (err?.response?.data?.error?.message || "").toLowerCase();
  return err?.response?.status === 403 && msg.includes("quota");
}

function isCommentsDisabledError(err) {
  const errors = err?.response?.data?.error?.errors;
  if (Array.isArray(errors)) {
    return errors.some((e) => e.reason === "commentsDisabled");
  }
  const msg = (err?.response?.data?.error?.message || "").toLowerCase();
  return err?.response?.status === 403 && msg.includes("disabled comments");
}

function handleError(res, err) {
  const apiMsg = err?.response?.data?.error?.message;
  if (isCommentsDisabledError(err)) {
    return res.status(403).json({
      error: "Comments are disabled for this video.",
    });
  }
  if (isQuotaError(err)) {
    return res.status(403).json({
      error: apiMsg || "YouTube API quota exceeded. Try again tomorrow.",
    });
  }
  res.status(500).json({ error: apiMsg || err.message || "Unknown error" });
}

function sortVideos(items, sort) {
  const direction = sort.endsWith("-asc") ? 1 : -1;
  switch (sort) {
    case "date-asc":
    case "date-desc":
      return items.sort((a, b) =>
        a.snippet.publishedAt.localeCompare(b.snippet.publishedAt) * direction
      );
    case "viewcount-asc":
    case "viewcount-desc":
      return items.sort((a, b) =>
        (Number(a.statistics?.viewCount || 0) - Number(b.statistics?.viewCount || 0)) * direction
      );
    case "rating-asc":
    case "rating-desc":
      return items.sort((a, b) => {
        const aLike = Number(a.statistics?.likeCount || 0);
        const bLike = Number(b.statistics?.likeCount || 0);
        const aViews = Number(a.statistics?.viewCount || 0);
        const bViews = Number(b.statistics?.viewCount || 0);
        const aScore = aViews ? aLike / aViews : aLike;
        const bScore = bViews ? bLike / bViews : bLike;
        return (aScore - bScore) * direction;
      });
    case "title-asc":
    case "title-desc":
      return items.sort((a, b) =>
        a.snippet.title.localeCompare(b.snippet.title, undefined, { numeric: true, sensitivity: "base" }) * direction
      );
    case "duration-asc":
    case "duration-desc":
      return items.sort((a, b) => {
        const aSeconds = durationToSeconds(a.contentDetails?.duration);
        const bSeconds = durationToSeconds(b.contentDetails?.duration);
        if (aSeconds === null && bSeconds === null) return 0;
        if (aSeconds === null) return 1;
        if (bSeconds === null) return -1;
        return (aSeconds - bSeconds) * direction;
      });
    default:
      return items;
  }
}

async function loadChannels() {
  if (!channelCollection) return [];
  return await getChannelCollection()
    .find({}, { projection: { _id: 0 } })
    .sort({ name: 1 })
    .toArray();
}

/**
 * @swagger
 * /api/channels:
 *   get:
 *     summary: Get all saved channels
 *     responses:
 *       200:
 *         description: Array of channel objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   id:
 *                     type: string
 */

app.get("/api/channels", async (req, res) => {
  try {
    const channels = await loadChannels();
    res.json(channels);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * @swagger
 * /api/channels:
 *   post:
 *     summary: Add a new channel
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Channel added
 *       400:
 *         description: Missing name or id
 *       409:
 *         description: Channel already exists
 */

app.post("/api/channels", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const id = String(req.body.id || "").trim();
    if (!name || !id) {
      return res.status(400).json({ error: "Channel name and id are required." });
    }
    const coll = getChannelCollection();
    const existing = await coll.findOne({ id });
    if (existing) {
      return res.status(409).json({ error: "A channel with that id already exists." });
    }
    const channel = { name, id };
    await coll.insertOne(channel);
    res.status(201).json(channel);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * @swagger
 * /api/channels/{currentId}:
 *   put:
 *     summary: Update a saved channel
 *     parameters:
 *       - in: path
 *         name: currentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               id: { type: string }
 *     responses:
 *       200: { description: Channel updated }
 *       404: { description: Channel not found }
 *       409: { description: ID conflict }
 */

app.put("/api/channels/:currentId", async (req, res) => {
  try {
    const currentId = req.params.currentId;
    const name = String(req.body.name || "").trim();
    const id = String(req.body.id || "").trim();
    if (!name || !id) {
      return res.status(400).json({ error: "Channel name and id are required." });
    }
    const coll = getChannelCollection();
    const existing = await coll.findOne({ id: currentId });
    if (!existing) {
      return res.status(404).json({ error: "Channel not found." });
    }
    if (currentId !== id) {
      const duplicate = await coll.findOne({ id });
      if (duplicate) {
        return res.status(409).json({ error: "A channel with the new id already exists." });
      }
    }
    await coll.updateOne({ id: currentId }, { $set: { name, id } });
    res.json({ name, id });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * @swagger
 * /api/channels/{id}:
 *   delete:
 *     summary: Delete a saved channel
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Channel not found }
 */

app.delete("/api/channels/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const coll = getChannelCollection();
    const result = await coll.deleteOne({ id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Channel not found." });
    }
    res.json({ deleted: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 1 – Single video details ───────────────────────────────────────

/**
 * @swagger
 * /api/video:
 *   get:
 *     summary: Get single video details
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Video ID or URL
 *     responses:
 *       200: { description: Video object }
 *       400: { description: Invalid video ID }
 *       404: { description: Video not found }
 */

app.get("/api/video", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const vid = parseVideoId(raw);
    if (!vid) {
      return res.status(400).json({ error: "Could not parse a valid video ID from the input." });
    }

    // A video lookup does 1-2 API calls (video details, plus a channel
    // lookup for the avatar) — cache the finished shape so revisiting the
    // same video (e.g. navigating back to the Video Player tab) is free.
    let shaped = videoCache.get(vid);
    if (!shaped) {
      const data = await ytFetch("videos", {
        part: "snippet,contentDetails,statistics,liveStreamingDetails",
        id: vid,
      });
      if (!data.items?.length) {
        return res.status(404).json({ error: "No video found with that ID." });
      }
      const item = data.items[0];
      shaped = shapeVideo(item, vid);

      // Single-item lookup only — fetch the uploading channel's avatar so the
      // Video Player tab can show a small channel profile picture. Not done
      // for list endpoints (search/playlist/channel-videos) to avoid an extra
      // API call per item.
      try {
        const channelId = item.snippet?.channelId;
        if (channelId) {
          const chData = await ytFetch("channels", { part: "snippet", id: channelId });
          const chThumb = chData.items?.[0]?.snippet?.thumbnails;
          shaped.channelThumbnail =
            chThumb?.high?.url || chThumb?.medium?.url || chThumb?.default?.url || null;
        }
      } catch {
        shaped.channelThumbnail = null;
      }

      videoCache.set(vid, shaped);
    }

    res.json(shaped);
  } catch (err) {
    // YouTube API may return 404 for invalid video IDs
    if (err?.response?.status === 404) {
      return res.status(404).json({
        error: "The video could not be found. Please check the video ID or URL."
      });
    }
    handleError(res, err);
  }
});

// ── Part 2 – Channel search / filter ──────────────────────────────────────

/**
 * @swagger
 * /api/channel-videos:
 *   get:
 *     summary: Search videos within a channel
 *     parameters:
 *       - in: query
 *         name: channelId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: mode
 *         schema: { type: string, enum: [keyword, date] }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: keywordTitle
 *         schema: { type: string }
 *       - in: query
 *         name: keywordDescription
 *         schema: { type: string }
 *       - in: query
 *         name: keywordChannel
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: durationFilter
 *         schema: { type: string, enum: [short, medium, long] }
 *       - in: query
 *         name: matchMode
 *         schema: { type: string, enum: [every, some] }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Videos array
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 videos: { type: array }
 *                 count: { type: integer }
 */

app.get("/api/channel-videos", async (req, res) => {
  try {
    const {
      channelId,
      mode, // 'keyword' | 'date'
      keyword,
      keywordTitle,
      keywordDescription,
      keywordChannel,
      startDate,
      endDate,
      durationFilter, // 'short' | 'medium' | 'long'
      matchMode,      // 'every' | 'some'
    } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const limit = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 50, 1), 500);

    // Determine if we're in per-field mode
    const hasPerField = [keywordTitle, keywordDescription, keywordChannel].some(
      (k) => k && k.trim()
    );

    // Paging through search + batch-fetching full video details is the
    // expensive part. Cache the filtered-but-unsorted result set keyed on
    // every param that affects it (i.e. everything except `sort`), so
    // changing just the sort dropdown re-sorts in memory instead of
    // re-running the whole search.
    const cvKey = cacheKey({
      channelId, mode, keyword, keywordTitle, keywordDescription, keywordChannel,
      startDate, endDate, durationFilter, matchMode, limit,
    });
    let fullItems = channelVideosCache.get(cvKey);
    if (!fullItems) {
      // For the YouTube search API q= param, use the combined keyword or the title keyword as the
      // primary signal (the real filtering is done server-side after fetching full details)
      const apiKeyword = keyword || keywordTitle || "";

      const params = {
        part: "snippet",
        channelId,
        maxResults: 50,
        order: "date",
        type: "video",
      };
      if (durationFilter) params.videoDuration = durationFilter;
      if (startDate) params.publishedAfter = `${startDate}T00:00:00Z`;
      if (endDate) params.publishedBefore = `${endDate}T23:59:59Z`;
      if (mode === "keyword" && apiKeyword) params.q = apiKeyword;

      let videoIds = [];
      let nextPage;
      let pageNumber = 0;
      do {
        const p = { ...params };
        if (nextPage) p.pageToken = nextPage;
        const resp = await ytFetchWithPaginationDelay("search", p, pageNumber);
        for (const item of resp.items || []) {
          const vidId = item.id?.videoId;
          if (vidId) videoIds.push(vidId);
        }
        nextPage = resp.nextPageToken;
        if (videoIds.length >= limit) break;
        pageNumber += 1;
      } while (nextPage);

      videoIds = videoIds.slice(0, limit);

      if (!videoIds.length) {
        fullItems = [];
      } else {
        fullItems = [];
        for (let i = 0; i < videoIds.length; i += 50) {
          const batch = videoIds.slice(i, i + 50);
          const vresp = await ytFetch("videos", {
            part: "snippet,contentDetails,statistics,liveStreamingDetails",
            id: batch.join(","),
          });
          fullItems.push(...(vresp.items || []));
        }

        if (mode === "keyword") {
          if (hasPerField) {
            fullItems = fullItems.filter((v) =>
              keywordMatchesPerField(v.snippet, { keywordTitle, keywordDescription, keywordChannel }, matchMode)
            );
          } else if (keyword) {
            fullItems = fullItems.filter((v) =>
              keywordMatches([v.snippet.title, v.snippet.description, v.snippet.channelTitle], keyword, matchMode)
            );
          }
        }
      }

      channelVideosCache.set(cvKey, fullItems);
    }

    if (!fullItems.length) {
      return res.json({ videos: [], count: 0 });
    }

    const sortedItems = fullItems.slice();
    const sort = String(req.query.sort || "relevance").toLowerCase();
    sortVideos(sortedItems, sort);

    const videos = sortedItems.map((v) => shapeVideo(v));
    res.json({ videos, count: videos.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 3b – Latest videos from a channel's uploads playlist ─────────────
//
// Fetches the most recent 5-50 videos for a channel via its uploads
// playlist, instead of the (quota-expensive) search endpoint or a full walk
// of the entire playlist. Each page is a single playlistItems.list call
// (maxResults ≤ 50 covers the whole supported range), and we pass through
// YouTube's own nextPageToken/prevPageToken so callers can page forward and
// backward through the uploads playlist without ever fetching all of it.

/**
 * @swagger
 * /api/channel-latest-videos:
 *   get:
 *     summary: Get latest uploads from a channel
 *     parameters:
 *       - in: query
 *         name: channelId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: count
 *         schema: { type: integer, minimum: 1, maximum: 50 }
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *     responses:
 *       200: { description: Videos array with pagination tokens }
 */

app.get("/api/channel-latest-videos", async (req, res) => {
  try {
    const { channelId, pageToken } = req.query;
    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const count = parseInt(req.query.count, 10);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return res.status(400).json({ error: "count must be an integer between 1 and 50 (inclusive)." });
    }

    // Each page here is 2-3 sequential API calls (channel lookup, playlistItems
    // page, videos batch). Cache the finished page per channelId+count+pageToken
    // so re-visiting the same page of a channel's latest uploads is free.
    const key = cacheKey({ channelId, count, pageToken: pageToken || "" });
    let result = channelLatestVideosCache.get(key);
    if (!result) {
      const chResp = await ytFetch("channels", { part: "contentDetails", id: channelId });
      const uploadsPlaylistId = chResp.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        return res.status(404).json({ error: "No uploads playlist found for that channel." });
      }

      const itemsParams = {
        part: "snippet",
        playlistId: uploadsPlaylistId,
        maxResults: count,
      };
      if (pageToken) itemsParams.pageToken = pageToken;

      const itemsResp = await ytFetch("playlistItems", itemsParams);
      const nextPageToken = itemsResp.nextPageToken || null;
      const prevPageToken = itemsResp.prevPageToken || null;

      const videoIds = (itemsResp.items || [])
        .map((item) => item.snippet?.resourceId?.videoId)
        .filter(Boolean);

      if (!videoIds.length) {
        result = { videos: [], count: 0, uploadsPlaylistId, nextPageToken, prevPageToken };
      } else {
        const vResp = await ytFetch("videos", {
          part: "snippet,contentDetails,statistics,liveStreamingDetails",
          id: videoIds.join(","),
        });

        // The uploads playlist is expected to already return newest-first within
        // each page, but we don't rely on that assumption — sort explicitly by
        // publish date so ordering within the page is guaranteed regardless.
        const fullItems = (vResp.items || []).sort((a, b) =>
          b.snippet.publishedAt.localeCompare(a.snippet.publishedAt)
        );

        const videos = fullItems.slice(0, count).map((v) => shapeVideo(v));
        result = { videos, count: videos.length, uploadsPlaylistId, nextPageToken, prevPageToken };
      }

      channelLatestVideosCache.set(key, result);
    }

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 3 – Channel details ──────────────────────────────────────────────

/**
 * @swagger
 * /api/channel:
 *   get:
 *     summary: Get channel details
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Channel ID, URL, or handle
 *     responses:
 *       200: { description: Channel object }
 *       400: { description: Invalid channel input }
 *       404: { description: Channel not found }
 */

app.get("/api/channel", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const chId = await parseChannelId(raw, ytFetch);
    if (!chId) {
      return res.status(400).json({ error: "Could not parse a valid channel ID from the input." });
    }

    // Cache the shaped channel object by its resolved ID — repeat lookups of
    // the same channel (including via a different handle/URL that resolves
    // to the same ID) skip the channels.list call entirely.
    let shaped = channelCache.get(chId);
    if (!shaped) {
      const data = await ytFetch("channels", {
        part: "snippet,brandingSettings,statistics,contentDetails",
        id: chId,
      });
      if (!data.items?.length) {
        return res.status(404).json({ error: "No channel found with that ID." });
      }
      const ch = data.items[0];
      const sn = ch.snippet;
      const bs = ch.brandingSettings || {};
      const st = ch.statistics || {};
      const cd = ch.contentDetails || {};
      const uploadsPlaylistId = cd.relatedPlaylists?.uploads || null;
      const thumb = sn.thumbnails || {};
      const thumbUrl =
        thumb.high?.url ||
        thumb.maxres?.url ||
        thumb.standard?.url ||
        thumb.medium?.url ||
        thumb.default?.url ||
        null;
      const banner =
        bs.image?.bannerExternalUrl ||
        bs.image?.bannerImageUrl ||
        bs.image?.bannerMobileImageUrl ||
        bs.image?.bannerTabletImageUrl ||
        bs.image?.bannerTabletLowImageUrl ||
        bs.image?.bannerTvImageUrl ||
        bs.image?.bannerTvLowImageUrl ||
        bs.image?.bannerMobileLowImageUrl ||
        null;

      shaped = {
        channelId: ch.id,
        title: sn.title,
        description: (sn.description || "").trim(),
        createdAt: fmtDatetime(sn.publishedAt),
        customUrl: sn.customUrl || "N/A",
        country: fmtCountry(sn.country),
        thumbnail: thumbUrl,
        banner,
        videoCount: st.videoCount ?? "N/A",
        subscriberCount: st.subscriberCount ?? "N/A",
        viewCount: st.viewCount ?? "N/A",
        uploadsPlaylistId,
      };

      channelCache.set(chId, shaped);
    }

    // Note: public playlists are intentionally NOT fetched here. Listing a
    // channel's playlists can require many sequential playlists.list calls
    // for channels with lots of playlists, so that work only happens when
    // the user explicitly requests it via GET /api/channel-playlists.
    res.json(shaped);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 3c – Channel's public playlists (fetched on demand) ───────────────
//
// Split out from /api/channel so that a channel lookup never implicitly pages
// through every playlists.list result — that only happens when the user
// clicks "Fetch Playlists".

/**
 * @swagger
 * /api/channel-playlists:
 *   get:
 *     summary: Fetch all public playlists for a channel
 *     parameters:
 *       - in: query
 *         name: channelId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Playlists array }
 *       400: { description: Invalid channelId }
 *       404: { description: Channel not found }
 */

app.get("/api/channel-playlists", async (req, res) => {
  try {
    const channelId = (req.query.channelId || "").trim();
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
      return res.status(400).json({ error: "A valid channelId is required." });
    }

    // This walks every page of the channel's playlists.list results — for a
    // channel with hundreds of playlists that's a lot of sequential calls.
    // Cache the finished list per channelId so re-fetching (e.g. navigating
    // away and back) doesn't repeat that work.
    let result = channelPlaylistsCache.get(channelId);
    if (!result) {
      const data = await ytFetch("channels", {
        part: "snippet,statistics,contentDetails",
        id: channelId,
      });
      if (!data.items?.length) {
        return res.status(404).json({ error: "No channel found with that ID." });
      }
      const ch = data.items[0];
      const sn = ch.snippet;
      const st = ch.statistics || {};
      const cd = ch.contentDetails || {};
      const uploadsPlaylistId = cd.relatedPlaylists?.uploads || null;
      const thumb = sn.thumbnails || {};
      const thumbUrl =
        thumb.high?.url ||
        thumb.maxres?.url ||
        thumb.standard?.url ||
        thumb.medium?.url ||
        thumb.default?.url ||
        null;

      const playlists = [];
      let playlistPageToken;
      let playlistPageNumber = 0;
      do {
        const playlistResp = await ytFetchWithPaginationDelay(
          "playlists",
          {
            part: "snippet,contentDetails",
            channelId: ch.id,
            maxResults: 50,
            pageToken: playlistPageToken,
          },
          playlistPageNumber
        );
        for (const item of playlistResp.items || []) {
          const rawCount = item.contentDetails?.itemCount;
          const plThumb = item.snippet?.thumbnails || {};
          playlists.push({
            playlistId: item.id,
            playlistUrl: `https://www.youtube.com/playlist?list=${item.id}`,
            title: item.snippet?.title || "N/A",
            channelId: item.snippet?.channelId || ch.id,
            publishedAt: fmtDatetime(item.snippet?.publishedAt),
            publishedAtRaw: item.snippet?.publishedAt || null,
            videoCount: rawCount ?? "N/A",
            videoCountRaw: rawCount != null ? Number(rawCount) : null,
            thumbnail:
              plThumb.maxres?.url ||
              plThumb.standard?.url ||
              plThumb.high?.url ||
              plThumb.medium?.url ||
              plThumb.default?.url ||
              null,
          });
        }
        playlistPageToken = playlistResp.nextPageToken;
        playlistPageNumber += 1;
      } while (playlistPageToken);

      // The channel's uploads playlist (contentDetails.relatedPlaylists.uploads) is
      // never returned by playlists.list?channelId=..., since it's a synthetic
      // playlist rather than a user-created one. Add it in ourselves so it shows
      // up alongside the channel's other playlists — its videos can be viewed the
      // same way as any other playlist, via GET /api/playlist?q=<uploadsPlaylistId>.
      if (uploadsPlaylistId && !playlists.some((p) => p.playlistId === uploadsPlaylistId)) {
        const rawCount = st.videoCount;
        playlists.unshift({
          playlistId: uploadsPlaylistId,
          playlistUrl: `https://www.youtube.com/playlist?list=${uploadsPlaylistId}`,
          title: "Uploads",
          channelId: ch.id,
          publishedAt: fmtDatetime(sn.publishedAt),
          publishedAtRaw: sn.publishedAt || null,
          videoCount: rawCount ?? "N/A",
          videoCountRaw: rawCount != null ? Number(rawCount) : null,
          thumbnail: thumbUrl,
        });
      }

      result = { channelId: ch.id, playlists };
      channelPlaylistsCache.set(channelId, result);
    }

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 4 – Single comment by ID ──────────────────────────────────────────

/**
 * @swagger
 * /api/comment:
 *   get:
 *     summary: Get a single comment by ID
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Comment ID or URL with lc param
 *     responses:
 *       200: { description: Comment object }
 *       400: { description: Invalid comment ID }
 *       404: { description: Comment not found }
 */

app.get("/api/comment", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const commentId = parseCommentId(raw);
    if (!commentId) {
      return res.status(400).json({ error: "Could not parse a valid comment ID from the input." });
    }
    const data = await ytFetch("comments", {
      part: "snippet",
      id: commentId,
      textFormat: "plainText",
    });
    if (!data.items?.length) {
      return res.status(404).json({ error: "No comment found with that ID." });
    }
    const c = data.items[0];
    const sn = c.snippet;
    res.json({
      commentId: c.id,
      authorName: sn.authorDisplayName,
      authorChannelId: sn.authorChannelId?.value || "N/A",
      authorProfileImageUrl: sn.authorProfileImageUrl || null,
      textDisplay: sn.textDisplay || "",
      textOriginal: sn.textOriginal || "",
      likeCount: sn.likeCount ?? 0,
      publishedAt: fmtDatetime(sn.publishedAt),
      updatedAt: fmtDatetime(sn.updatedAt),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 5 – Comment threads with replies ──────────────────────────────────

/**
 * @swagger
 * /api/comments:
 *   get:
 *     summary: Get comment threads for a video
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Video ID or URL
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [top, latest, earliest, likes-desc, likes-asc] }
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 50 }
 *     responses:
 *       200: { description: Threads and pagination info }
 *       400: { description: Invalid format }
 *       403: { description: Comments disabled}
 *       404: { description: Video not found}
 */

app.get("/api/comments", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const videoId = parseVideoId(raw);
    if (!videoId) {
      return res.status(400).json({ error: "Could not parse a valid video ID from the input." });
    }

    const validSorts = ["top", "latest", "earliest", "likes-desc", "likes-asc"];
    const sortIn = String(req.query.sort || "top").toLowerCase();
    const sort = validSorts.includes(sortIn) ? sortIn : "top";
    const apiOrder = sort === "top" ? "relevance" : "time";
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const startDate = req.query.startDate ? new Date(`${req.query.startDate}T00:00:00Z`) : null;
    const endDate = req.query.endDate ? new Date(`${req.query.endDate}T23:59:59Z`) : null;
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

    const requestedMax = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 20, 1), 50);

    // Fetching this page of comment threads (plus the video-stats lookup for
    // the total count) is 1-2 API calls. Keyword/date filtering and the final
    // in-memory sort don't need fresh data, so cache the mapped-but-unfiltered
    // page keyed on everything that *does* require a new YouTube call:
    // videoId, the API-level order ("relevance" vs "time" — shared by
    // latest/earliest), pageToken, and page size.
    const commentsKey = cacheKey({ videoId, apiOrder, pageToken: pageToken || "", requestedMax });
    let pageData = commentsCache.get(commentsKey);
    if (!pageData) {
      let totalCommentCount = null;
      try {
        const videoStats = await ytFetch("videos", { part: "statistics", id: videoId });
        const rawCount = videoStats.items?.[0]?.statistics?.commentCount;
        totalCommentCount = rawCount != null ? Number(rawCount) : null;
      } catch {
        // Non-fatal: leave totalCommentCount as null if this lookup fails.
      }

      const params = {
        part: "snippet,replies",
        videoId,
        maxResults: requestedMax,
        textFormat: "plainText",
        order: apiOrder,
      };
      if (pageToken) params.pageToken = pageToken;
      const resp = await ytFetch("commentThreads", params);

      const mappedThreads = (resp.items || []).map((thread) => {
        const top = thread.snippet.topLevelComment;
        const sn = top.snippet;
        const replies = (thread.replies?.comments || []).map((reply) => {
          const rs = reply.snippet;
          return {
            commentId: reply.id,
            authorName: rs.authorDisplayName,
            authorChannelId: rs.authorChannelId?.value || "N/A",
            authorChannelUrl: rs.authorChannelUrl || null,
            authorProfileImageUrl: rs.authorProfileImageUrl || null,
            likeCount: rs.likeCount ?? 0,
            publishedAt: fmtDatetimeAt(rs.publishedAt),
            updatedAt: fmtDatetimeAt(rs.updatedAt),
            textDisplay: rs.textDisplay || "",
            textOriginal: rs.textOriginal || "",
            publishedAtRaw: rs.publishedAt,
          };
        });
        return {
          commentId: top.id,
          authorName: sn.authorDisplayName,
          authorChannelId: sn.authorChannelId?.value || "N/A",
          authorChannelUrl: sn.authorChannelUrl || null,
          authorProfileImageUrl: sn.authorProfileImageUrl || null,
          likeCount: sn.likeCount ?? 0,
          publishedAt: fmtDatetimeAt(sn.publishedAt),
          updatedAt: fmtDatetimeAt(sn.updatedAt),
          textDisplay: sn.textDisplay || "",
          textOriginal: sn.textOriginal || "",
          replyCount: thread.snippet.totalReplyCount ?? 0,
          replies,
          publishedAtRaw: sn.publishedAt,
        };
      });

      pageData = {
        totalCommentCount,
        threads: mappedThreads,
        nextPageToken: resp.nextPageToken || null,
      };
      commentsCache.set(commentsKey, pageData);
    }

    const totalCommentCount = pageData.totalCommentCount;
    const threads = pageData.threads
      .filter((thread) => {
        if (keyword) {
          const threadText = `${thread.textDisplay} ${thread.textOriginal}`.toLowerCase();
          const replyText = thread.replies
            .map((reply) => `${reply.textDisplay} ${reply.textOriginal}`.toLowerCase())
            .join(" ");
          if (!threadText.includes(keyword) && !replyText.includes(keyword)) {
            return false;
          }
        }
        if (startDate && new Date(thread.publishedAtRaw) < startDate) {
          return false;
        }
        if (endDate && new Date(thread.publishedAtRaw) > endDate) {
          return false;
        }
        return true;
      });

    if (sort === "earliest") {
      threads.sort((a, b) => new Date(a.publishedAtRaw) - new Date(b.publishedAtRaw));
    } else if (sort === "latest") {
      threads.sort((a, b) => new Date(b.publishedAtRaw) - new Date(a.publishedAtRaw));
    } else if (sort === "likes-desc") {
      threads.sort((a, b) => Number(b.likeCount) - Number(a.likeCount));
    } else if (sort === "likes-asc") {
      threads.sort((a, b) => Number(a.likeCount) - Number(b.likeCount));
    }

    const nextPageTokenOut = pageData.nextPageToken;

    res.json({
      videoId,
      commentCount: totalCommentCount,
      hasMore: Boolean(nextPageTokenOut),
      nextPageToken: nextPageTokenOut,
      sort,
      threads,
    });
  } catch (err) {
    // Check for video not found errors from YouTube API
    const errorData = err?.response?.data?.error;
    const errorMessage = errorData?.message || "";
    const errorStatus = err?.response?.status;

    // YouTube returns 404 or a specific message when video is not found
    if (errorStatus === 404 ||
      (errorData?.errors && errorData.errors.some(e => e.reason === "notFound")) ||
      errorMessage.toLowerCase().includes("video") &&
      errorMessage.toLowerCase().includes("not found")) {
      return res.status(404).json({
        error: "The video could not be found. Please check the video ID or URL."
      });
    }

    // Handle other errors (quota, disabled comments, etc.)
    handleError(res, err);
  }
});

/**
 * @swagger
 * /api/comment-replies:
 *   get:
 *     summary: Get replies to a comment thread
 *     parameters:
 *       - in: query
 *         name: parentId
 *         required: true
 *         schema: { type: string }
 *         description: Top‑level comment ID
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 50 }
 *     responses:
 *       200: { description: Reply objects and pagination }
 */

app.get("/api/comment-replies", async (req, res) => {
  try {
    const parentId = String(req.query.parentId || "").trim();
    if (!parentId) {
      return res.status(400).json({ error: "Missing parentId query parameter." });
    }
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

    const requestedMaxReplies = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 20, 1), 50);
    const params = {
      part: "snippet",
      parentId,
      maxResults: requestedMaxReplies,
      textFormat: "plainText",
    };
    if (pageToken) params.pageToken = pageToken;

    const resp = await ytFetch("comments", params);
    const replies = (resp.items || []).map((reply) => {
      const rs = reply.snippet;
      return {
        commentId: reply.id,
        authorName: rs.authorDisplayName,
        authorChannelId: rs.authorChannelId?.value || "N/A",
        authorChannelUrl: rs.authorChannelUrl || null,
        authorProfileImageUrl: rs.authorProfileImageUrl || null,
        likeCount: rs.likeCount ?? 0,
        publishedAt: fmtDatetimeAt(rs.publishedAt),
        updatedAt: fmtDatetimeAt(rs.updatedAt),
        textDisplay: rs.textDisplay || "",
        textOriginal: rs.textOriginal || "",
        publishedAtRaw: rs.publishedAt,
      };
    });

    res.json({
      parentId,
      replies,
      hasMore: Boolean(resp.nextPageToken),
      nextPageToken: resp.nextPageToken || null,
      totalResults: resp.pageInfo?.totalResults ?? null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 5 – Playlist videos ────────────────────────────────────────────────

// Fetches playlist metadata + every video in the playlist from YouTube.
// This is the expensive part (dozens of sequential API calls for a large
// playlist) — isolated here so it can be skipped entirely on a cache hit.
async function fetchFullPlaylistFromYouTube(playlistId) {
  // Fetch playlist metadata
  const playlistMetadata = await ytFetch("playlists", {
    part: "snippet",
    id: playlistId,
  });

  let playlistInfo = {};
  if (playlistMetadata.items?.length) {
    const playlist = playlistMetadata.items[0];
    const plThumb = playlist.snippet?.thumbnails || {};
    playlistInfo = {
      playlistId: playlist.id,
      title: playlist.snippet?.title || "N/A",
      channelId: playlist.snippet?.channelId || "N/A",
      channelTitle: playlist.snippet?.channelTitle || "N/A",
      publishedAt: fmtDatetime(playlist.snippet?.publishedAt),
      description: (playlist.snippet?.description || "").trim(),
      thumbnail:
        plThumb.maxres?.url ||
        plThumb.standard?.url ||
        plThumb.high?.url ||
        plThumb.medium?.url ||
        plThumb.default?.url ||
        null,
    };
  } else {
    // "Special" playlists (channel uploads = UU, liked videos = LL, legacy
    // favorites = FL, watch later = WL) are never returned by playlists.list,
    // even by ID — but their ID encodes the owning channel's ID (swap the
    // 2-letter prefix for "UC"), so we can still show meaningful details by
    // looking up that channel instead. playlistItems.list below works fine
    // for these regardless.
    const SPECIAL_PLAYLIST_LABELS = { UU: "Uploads", LL: "Liked videos", FL: "Favorites", WL: "Watch later" };
    const prefix = playlistId.slice(0, 2).toUpperCase();
    const label = SPECIAL_PLAYLIST_LABELS[prefix];
    if (label) {
      try {
        const derivedChannelId = `UC${playlistId.slice(2)}`;
        const chResp = await ytFetch("channels", { part: "snippet", id: derivedChannelId });
        const ch = chResp.items?.[0];
        if (ch) {
          const chThumb = ch.snippet?.thumbnails || {};
          playlistInfo = {
            playlistId,
            title: `${ch.snippet.title} – ${label}`,
            channelId: ch.id,
            channelTitle: ch.snippet.title,
            publishedAt: fmtDatetime(ch.snippet.publishedAt),
            description: (ch.snippet.description || "").trim(),
            thumbnail:
              chThumb.maxres?.url ||
              chThumb.standard?.url ||
              chThumb.high?.url ||
              chThumb.medium?.url ||
              chThumb.default?.url ||
              null,
          };
        }
      } catch {
        // Non-fatal — the video listing below still works without playlistInfo.
      }
    }
  }

  let videoIds = [];
  let nextPage;
  let pageNumber = 0;
  do {
    const params = { part: "snippet", playlistId, maxResults: 50 };
    if (nextPage) params.pageToken = nextPage;
    const resp = await ytFetchWithPaginationDelay("playlistItems", params, pageNumber);
    for (const item of resp.items || []) {
      const vidId = item.snippet?.resourceId?.videoId;
      if (vidId) videoIds.push(vidId);
    }
    nextPage = resp.nextPageToken;
    pageNumber += 1;
  } while (nextPage);

  let items = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const vresp = await ytFetch("videos", {
      part: "snippet,contentDetails,statistics,liveStreamingDetails",
      id: batch.join(","),
    });
    items.push(...(vresp.items || []));
  }

  return { playlistInfo, items };
}

/**
 * @swagger
 * /api/playlist:
 *   get:
 *     summary: Get all videos from a playlist
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Playlist ID or URL
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Playlist info and videos (paginated)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlistInfo: { type: object }
 *                 videos: { type: array }
 *                 count: { type: integer }
 *                 nextPageToken: { type: string }
 */

app.get("/api/playlist", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const playlistId = parsePlaylistId(raw);
    if (!playlistId) {
      return res.status(400).json({ error: "Could not parse a valid playlist ID from the input." });
    }

    // Serve from cache when possible — this is what makes sort changes and
    // "View more videos" pagination fast: they no longer re-fetch the whole
    // playlist from YouTube, they just re-sort/re-slice data already in memory.
    let cached = playlistCache.get(playlistId);
    if (!cached) {
      cached = await fetchFullPlaylistFromYouTube(playlistId);
      playlistCache.set(playlistId, cached);
    }

    const { playlistInfo, items } = cached;

    if (!items.length) {
      return res.json({ playlistInfo, videos: [], count: 0 });
    }

    // Sort a copy so the cached order/reference stays stable across requests.
    const sortedItems = items.slice().sort((a, b) =>
      a.snippet.publishedAt.localeCompare(b.snippet.publishedAt)
    );
    const sort = String(req.query.sort || "date-asc").toLowerCase();
    sortVideos(sortedItems, sort);

    // Server-side paging: support offset-style page tokens and maxResults.
    // Only the requested slice is shaped, not the whole playlist.
    const max = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 50, 1), 500);
    const start = req.query.pageToken ? Math.max(parseInt(req.query.pageToken, 10) || 0, 0) : 0;
    const end = Math.min(start + max, sortedItems.length);
    const pageSlice = sortedItems.slice(start, end).map((v) => shapeVideo(v));
    const nextPageToken = end < sortedItems.length ? String(end) : null;

    res.json({
      playlistInfo,
      videos: pageSlice,
      count: sortedItems.length,
      nextPageToken,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 6 – Search videos (general) ────────────────────────────────────────

/**
 * @swagger
 * /api/search-videos:
 *   get:
 *     summary: Search videos across YouTube
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: keywordTitle
 *         schema: { type: string }
 *       - in: query
 *         name: keywordDescription
 *         schema: { type: string }
 *       - in: query
 *         name: keywordChannel
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: durationFilter
 *         schema: { type: string, enum: [short, medium, long] }
 *       - in: query
 *         name: matchMode
 *         schema: { type: string, enum: [every, some] }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Videos array and count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 videos: { type: array }
 *                 count: { type: integer }
 */

app.get("/api/search-videos", async (req, res) => {
  try {
    const {
      keyword,
      keywordTitle,
      keywordDescription,
      keywordChannel,
      startDate,
      endDate,
      durationFilter, // 'short' | 'medium' | 'long'
      matchMode,      // 'every' | 'some'
    } = req.query;

    // Determine mode
    const hasPerField = [keywordTitle, keywordDescription, keywordChannel].some(
      (k) => k && k.trim()
    );

    // At least one of keyword, date range, or duration filter must be provided
    if (!keyword && !hasPerField && !startDate && !endDate && !durationFilter) {
      return res.status(400).json({ error: "Provide a keyword, date range, or duration type" });
    }

    const limit = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 50, 1), 500);

    // Cache the filtered-but-unsorted result set keyed on every param except
    // `sort` — re-sorting an already-fetched search is instant this way.
    const svKey = cacheKey({
      keyword, keywordTitle, keywordDescription, keywordChannel,
      startDate, endDate, durationFilter, matchMode, limit,
    });
    let fullItems = searchVideosCache.get(svKey);
    if (!fullItems) {
      // Use the combined keyword or title keyword for the YouTube search API q= param
      const apiKeyword = keyword || keywordTitle || "";

      const params = {
        part: "snippet",
        maxResults: 50,
        order: "date",
        type: "video",
      };
      if (apiKeyword) params.q = apiKeyword;
      if (durationFilter) params.videoDuration = durationFilter;
      if (startDate) params.publishedAfter = `${startDate}T00:00:00Z`;
      if (endDate) params.publishedBefore = `${endDate}T23:59:59Z`;

      let videoIds = [];
      let nextPage;
      let pageNumber = 0;
      do {
        const p = { ...params };
        if (nextPage) p.pageToken = nextPage;
        const resp = await ytFetchWithPaginationDelay("search", p, pageNumber);
        for (const item of resp.items || []) {
          const vidId = item.id?.videoId;
          if (vidId) videoIds.push(vidId);
        }
        nextPage = resp.nextPageToken;
        if (videoIds.length >= limit) break;
        pageNumber += 1;
      } while (nextPage);

      videoIds = videoIds.slice(0, limit);

      if (!videoIds.length) {
        fullItems = [];
      } else {
        fullItems = [];
        for (let i = 0; i < videoIds.length; i += 50) {
          const batch = videoIds.slice(i, i + 50);
          const vresp = await ytFetch("videos", {
            part: "snippet,contentDetails,statistics,liveStreamingDetails",
            id: batch.join(","),
          });
          fullItems.push(...(vresp.items || []));
        }

        if (hasPerField) {
          fullItems = fullItems.filter((v) =>
            keywordMatchesPerField(v.snippet, { keywordTitle, keywordDescription, keywordChannel }, matchMode)
          );
        } else if (keyword) {
          fullItems = fullItems.filter((v) =>
            keywordMatches([v.snippet.title, v.snippet.description, v.snippet.channelTitle], keyword, matchMode)
          );
        }
      }

      searchVideosCache.set(svKey, fullItems);
    }

    if (!fullItems.length) {
      return res.json({ videos: [], count: 0 });
    }

    const sortedItems = fullItems.slice();
    const sort = String(req.query.sort || "relevance").toLowerCase();
    sortVideos(sortedItems, sort);

    const videos = sortedItems.map((v) => shapeVideo(v));
    res.json({ videos, count: videos.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 7 – Search channels ────────────────────────────────────────────────

/**
 * @swagger
 * /api/search-channels:
 *   get:
 *     summary: Search channels by name
 *     parameters:
 *       - in: query
 *         name: keyword
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Channels array and pagination tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 channels: { type: array }
 *                 count: { type: integer }
 *                 nextPageToken: { type: string }
 *                 prevPageToken: { type: string }
 */

app.get("/api/search-channels", async (req, res) => {
  try {
    const { keyword, maxResults, pageToken } = req.query;

    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: "keyword is required." });
    }

    const limit = Math.min(Math.max(parseInt(maxResults, 10) || 50, 1), 500);
    const apiKeyword = keyword;

    // Cache the finished page/result set keyed on keyword+limit+pageToken —
    // paging back and forth through the same search no longer re-hits
    // YouTube each time.
    const scKey = cacheKey({ keyword: apiKeyword, limit, pageToken: pageToken || "" });
    let result = searchChannelsCache.get(scKey);
    if (!result) {
      let channelIds = [];
      let nextPageToken = null;
      let prevPageToken = null;

      if (limit <= 50) {
        // A single YouTube search page (≤ 50 results) maps 1:1 to one page of
        // results here, so we can expose YouTube's own nextPageToken/
        // prevPageToken directly for real forward/backward pagination.
        const p = {
          part: "snippet",
          q: apiKeyword,
          maxResults: limit,
          type: "channel",
        };
        if (pageToken) p.pageToken = pageToken;
        const resp = await ytFetch("search", p);
        channelIds = (resp.items || []).map((item) => item.id?.channelId).filter(Boolean);
        nextPageToken = resp.nextPageToken || null;
        prevPageToken = resp.prevPageToken || null;
      } else {
        // Requests for more than one page's worth of results are aggregated
        // into a single larger batch (no per-page nav exposed for this mode,
        // since it already spans multiple underlying YouTube pages).
        let nextPage;
        let pageNumber = 0;
        do {
          const p = {
            part: "snippet",
            q: apiKeyword,
            maxResults: 50,
            type: "channel",
          };
          if (nextPage) p.pageToken = nextPage;
          const resp = await ytFetchWithPaginationDelay("search", p, pageNumber);
          for (const item of resp.items || []) {
            const cid = item.id?.channelId;
            if (cid) channelIds.push(cid);
          }
          nextPage = resp.nextPageToken;
          if (channelIds.length >= limit) break;
          pageNumber += 1;
        } while (nextPage);
        channelIds = channelIds.slice(0, limit);
      }

      if (!channelIds.length) {
        result = { channels: [], count: 0, nextPageToken, prevPageToken };
      } else {
        let fullItems = [];
        for (let i = 0; i < channelIds.length; i += 50) {
          const batch = channelIds.slice(i, i + 50);
          const resp = await ytFetch("channels", {
            part: "snippet,statistics",
            id: batch.join(","),
          });
          fullItems.push(...(resp.items || []));
        }

        fullItems = fullItems.filter((ch) =>
          keywordMatches([ch.snippet?.title || ""], keyword)
        );

        const channels = fullItems.map((ch) => {
          const sn = ch.snippet || {};
          const st = ch.statistics || {};
          const thumb = sn.thumbnails || {};
          return {
            channelId: ch.id,
            channelUrl: `https://www.youtube.com/channel/${ch.id}`,
            title: sn.title || "N/A",
            description: (sn.description || "").trim(),
            country: fmtCountry(sn.country),
            publishedAt: sn.publishedAt ? fmtDatetime(sn.publishedAt) : "N/A",
            subscribers: st.subscriberCount ?? "N/A",
            videoCount: st.videoCount ?? "N/A",
            viewCount: st.viewCount ?? "N/A",
            thumbnail:
              thumb.high?.url ||
              thumb.medium?.url ||
              thumb.default?.url ||
              null,
          };
        });

        result = { channels, count: channels.length, nextPageToken, prevPageToken };
      }

      searchChannelsCache.set(scKey, result);
    }

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 8 – Search playlists ───────────────────────────────────────────────

/**
 * @swagger
 * /api/search-playlists:
 *   get:
 *     summary: Search playlists by keyword
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema: { type: string }
 *       - in: query
 *         name: keywordTitle
 *         schema: { type: string }
 *       - in: query
 *         name: keywordChannel
 *         schema: { type: string }
 *       - in: query
 *         name: maxResults
 *         schema: { type: integer, minimum: 1, maximum: 500 }
 *     responses:
 *       200:
 *         description: Playlists array and count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playlists: { type: array }
 *                 count: { type: integer }
 */

app.get("/api/search-playlists", async (req, res) => {
  try {
    const { keyword, keywordTitle, keywordChannel, maxResults } = req.query;

    const hasPerField = [keywordTitle, keywordChannel].some((k) => k && k.trim());

    if (!keyword && !hasPerField) {
      return res.status(400).json({ error: "keyword is required." });
    }

    const limit = Math.min(Math.max(parseInt(maxResults, 10) || 50, 1), 500);

    const apiKeyword = keyword || keywordTitle || "";

    // Cache the filtered result set keyed on the params that determine it —
    // repeat searches (or minor UI re-renders triggering the same query)
    // skip the search + playlists.list batch calls entirely.
    const spKey = cacheKey({ keyword, keywordTitle, keywordChannel, limit });
    let playlists = searchPlaylistsCache.get(spKey);
    if (!playlists) {
      let playlistIds = [];
      let nextPage;
      let pageNumber = 0;
      do {
        const p = {
          part: "snippet",
          q: apiKeyword,
          maxResults: 50,
          type: "playlist",
        };
        if (nextPage) p.pageToken = nextPage;
        const resp = await ytFetchWithPaginationDelay("search", p, pageNumber);
        for (const item of resp.items || []) {
          const pid = item.id?.playlistId;
          if (pid) playlistIds.push(pid);
        }
        nextPage = resp.nextPageToken;
        if (playlistIds.length >= limit) break;
        pageNumber += 1;
      } while (nextPage);

      playlistIds = playlistIds.slice(0, limit);

      if (!playlistIds.length) {
        playlists = [];
      } else {
        let fullItems = [];
        for (let i = 0; i < playlistIds.length; i += 50) {
          const batch = playlistIds.slice(i, i + 50);
          const resp = await ytFetch("playlists", {
            part: "snippet,contentDetails",
            id: batch.join(","),
          });
          fullItems.push(...(resp.items || []));
        }

        if (hasPerField) {
          fullItems = fullItems.filter((pl) => {
            const title = pl.snippet?.title || "";
            const channelTitle = pl.snippet?.channelTitle || "";
            if (keywordTitle && keywordTitle.trim() && !keywordMatches([title], keywordTitle)) return false;
            if (keywordChannel && keywordChannel.trim() && !keywordMatches([channelTitle], keywordChannel)) return false;
            return true;
          });
        } else if (keyword) {
          fullItems = fullItems.filter((pl) =>
            keywordMatches([pl.snippet?.title || "", pl.snippet?.channelTitle || ""], keyword)
          );
        }

        playlists = fullItems.map((pl) => {
          const sn = pl.snippet || {};
          const cd = pl.contentDetails || {};
          const thumb = sn.thumbnails || {};
          const pid = pl.id;
          return {
            playlistId: pid,
            playlistUrl: `https://www.youtube.com/playlist?list=${pid}`,
            title: sn.title || "N/A",
            channelId: sn.channelId || "N/A",
            channelTitle: sn.channelTitle || "N/A",
            publishedAt: sn.publishedAt ? fmtDatetime(sn.publishedAt) : "N/A",
            videoCount: cd.itemCount ?? "N/A",
            thumbnail:
              thumb.standard?.url ||
              thumb.high?.url ||
              thumb.medium?.url ||
              thumb.default?.url ||
              null,
          };
        });
      }

      searchPlaylistsCache.set(spKey, playlists);
    }

    res.json({ playlists, count: playlists.length });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 apiKeySet: { type: boolean }
 */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeySet: !!API_KEY });
});

app.listen(PORT, () => {
  console.log(`YT Data backend running on http://localhost:${PORT}`);
});