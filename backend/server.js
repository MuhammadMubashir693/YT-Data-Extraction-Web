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
      const shouldRetry = status === 429 || status === 500 || status === 503;
      if (attempt === maxRetries || !shouldRetry) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, backoff(attempt)));
    }
  }
}

function handleError(res, err) {
  const apiMsg = err?.response?.data?.error?.message;
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
        a.snippet.title.localeCompare(b.snippet.title) * direction
      );
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

app.get("/api/channels", async (req, res) => {
  try {
    const channels = await loadChannels();
    res.json(channels);
  } catch (err) {
    handleError(res, err);
  }
});

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

app.get("/api/video", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const vid = parseVideoId(raw);
    if (!vid) {
      return res.status(400).json({ error: "Could not parse a valid video ID from the input." });
    }
    const data = await ytFetch("videos", {
      part: "snippet,contentDetails,statistics",
      id: vid,
    });
    if (!data.items?.length) {
      return res.status(404).json({ error: "No video found with that ID." });
    }
    const item = data.items[0];
    res.json(shapeVideo(item, vid));
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 2 – Channel search / filter ──────────────────────────────────────

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
    } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    // Determine if we're in per-field mode
    const hasPerField = [keywordTitle, keywordDescription, keywordChannel].some(
      (k) => k && k.trim()
    );
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
    do {
      const p = { ...params };
      if (nextPage) p.pageToken = nextPage;
      const resp = await ytFetch("search", p);
      for (const item of resp.items || []) {
        const vidId = item.id?.videoId;
        if (vidId) videoIds.push(vidId);
      }
      nextPage = resp.nextPageToken;
    } while (nextPage);

    if (!videoIds.length) {
      return res.json({ videos: [], count: 0 });
    }

    let fullItems = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const vresp = await ytFetch("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
      });
      fullItems.push(...(vresp.items || []));
    }

    if (mode === "keyword") {
      if (hasPerField) {
        fullItems = fullItems.filter((v) =>
          keywordMatchesPerField(v.snippet, { keywordTitle, keywordDescription, keywordChannel })
        );
      } else if (keyword) {
        fullItems = fullItems.filter((v) =>
          keywordMatches([v.snippet.title, v.snippet.description, v.snippet.channelTitle], keyword)
        );
      }
    }

    const sort = String(req.query.sort || "relevance").toLowerCase();
    sortVideos(fullItems, sort);

    const videos = fullItems.map((v) => shapeVideo(v));
    res.json({ videos, count: videos.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 3 – Channel details ──────────────────────────────────────────────

app.get("/api/channel", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const chId = await parseChannelId(raw, ytFetch);
    if (!chId) {
      return res.status(400).json({ error: "Could not parse a valid channel ID from the input." });
    }
    const data = await ytFetch("channels", {
      part: "snippet,brandingSettings,statistics",
      id: chId,
    });
    if (!data.items?.length) {
      return res.status(404).json({ error: "No channel found with that ID." });
    }
    const ch = data.items[0];
    const sn = ch.snippet;
    const bs = ch.brandingSettings || {};
    const st = ch.statistics || {};
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

    const playlists = [];
    let playlistPageToken;
    do {
      const playlistResp = await ytFetch("playlists", {
        part: "snippet,contentDetails",
        channelId: ch.id,
        maxResults: 50,
        pageToken: playlistPageToken,
      });
      for (const item of playlistResp.items || []) {
        playlists.push({
          playlistId: item.id,
          playlistUrl: `https://www.youtube.com/playlist?list=${item.id}`,
          title: item.snippet?.title || "N/A",
          channelId: item.snippet?.channelId || ch.id,
          publishedAt: fmtDatetime(item.snippet?.publishedAt),
          videoCount: item.contentDetails?.itemCount ?? "N/A",
        });
      }
      playlistPageToken = playlistResp.nextPageToken;
    } while (playlistPageToken);

    res.json({
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
      playlists,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 4 – Single comment by ID ──────────────────────────────────────────

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

app.get("/api/comments", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const videoId = parseVideoId(raw);
    if (!videoId) {
      return res.status(400).json({ error: "Could not parse a valid video ID from the input." });
    }

    const sort = String(req.query.sort || "top").toLowerCase();
    const apiOrder = sort === "top" ? "relevance" : "time";
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const startDate = req.query.startDate ? new Date(`${req.query.startDate}T00:00:00Z`) : null;
    const endDate = req.query.endDate ? new Date(`${req.query.endDate}T23:59:59Z`) : null;
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

    const params = {
      part: "snippet,replies",
      videoId,
      maxResults: 20,
      textFormat: "plainText",
      order: apiOrder,
    };
    if (pageToken) params.pageToken = pageToken;
    const resp = await ytFetch("commentThreads", params);

    const threads = (resp.items || [])
      .map((thread) => {
        const top = thread.snippet.topLevelComment;
        const sn = top.snippet;
        const replies = (thread.replies?.comments || []).map((reply) => {
          const rs = reply.snippet;
          return {
            commentId: reply.id,
            authorName: rs.authorDisplayName,
            authorChannelId: rs.authorChannelId?.value || "N/A",
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
      })
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
    }

    const commentCount = threads.reduce((total, thread) => total + 1 + thread.replies.length, 0);
    const totalThreads = resp.pageInfo?.totalResults ?? null;
    const nextPageTokenOut = resp.nextPageToken || null;

    res.json({
      videoId,
      commentCount,
      threadCount: threads.length,
      totalThreads,
      hasMore: Boolean(nextPageTokenOut),
      nextPageToken: nextPageTokenOut,
      sort: sort === "latest" ? "latest" : sort === "earliest" ? "earliest" : "top",
      threads,
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/comment-replies", async (req, res) => {
  try {
    const parentId = String(req.query.parentId || "").trim();
    if (!parentId) {
      return res.status(400).json({ error: "Missing parentId query parameter." });
    }
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

    const params = {
      part: "snippet",
      parentId,
      maxResults: 20,
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

app.get("/api/playlist", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const playlistId = parsePlaylistId(raw);
    if (!playlistId) {
      return res.status(400).json({ error: "Could not parse a valid playlist ID from the input." });
    }

    // Fetch playlist metadata
    const playlistMetadata = await ytFetch("playlists", {
      part: "snippet",
      id: playlistId,
    });

    let playlistInfo = {};
    if (playlistMetadata.items?.length) {
      const playlist = playlistMetadata.items[0];
      playlistInfo = {
        playlistId: playlist.id,
        title: playlist.snippet?.title || "N/A",
        channelId: playlist.snippet?.channelId || "N/A",
        publishedAt: fmtDatetime(playlist.snippet?.publishedAt),
      };
    }

    let videoIds = [];
    let nextPage;
    do {
      const params = { part: "snippet", playlistId, maxResults: 50 };
      if (nextPage) params.pageToken = nextPage;
      const resp = await ytFetch("playlistItems", params);
      for (const item of resp.items || []) {
        const vidId = item.snippet?.resourceId?.videoId;
        if (vidId) videoIds.push(vidId);
      }
      nextPage = resp.nextPageToken;
    } while (nextPage);

    if (!videoIds.length) {
      return res.json({ playlistInfo, videos: [], count: 0 });
    }

    let fullItems = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const vresp = await ytFetch("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
      });
      fullItems.push(...(vresp.items || []));
    }

    fullItems.sort((a, b) =>
      a.snippet.publishedAt.localeCompare(b.snippet.publishedAt)
    );

    const videos = fullItems.map((v) => shapeVideo(v));
    res.json({ playlistInfo, videos, count: videos.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Part 6 – Search videos (general) ────────────────────────────────────────

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
    } = req.query;

    // Determine mode
    const hasPerField = [keywordTitle, keywordDescription, keywordChannel].some(
      (k) => k && k.trim()
    );

    // At least one keyword must be provided
    if (!keyword && !hasPerField) {
      return res.status(400).json({ error: "keyword is required" });
    }

    // Use the combined keyword or title keyword for the YouTube search API q= param
    const apiKeyword = keyword || keywordTitle || "";

    const params = {
      part: "snippet",
      q: apiKeyword,
      maxResults: 50,
      order: "date",
      type: "video",
    };
    if (durationFilter) params.videoDuration = durationFilter;
    if (startDate) params.publishedAfter = `${startDate}T00:00:00Z`;
    if (endDate) params.publishedBefore = `${endDate}T23:59:59Z`;

    let videoIds = [];
    let nextPage;
    do {
      const p = { ...params };
      if (nextPage) p.pageToken = nextPage;
      const resp = await ytFetch("search", p);
      for (const item of resp.items || []) {
        const vidId = item.id?.videoId;
        if (vidId) videoIds.push(vidId);
      }
      nextPage = resp.nextPageToken;
    } while (nextPage);

    if (!videoIds.length) {
      return res.json({ videos: [], count: 0 });
    }

    let fullItems = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const vresp = await ytFetch("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
      });
      fullItems.push(...(vresp.items || []));
    }

    if (hasPerField) {
      fullItems = fullItems.filter((v) =>
        keywordMatchesPerField(v.snippet, { keywordTitle, keywordDescription, keywordChannel })
      );
    } else if (keyword) {
      fullItems = fullItems.filter((v) =>
        keywordMatches([v.snippet.title, v.snippet.description, v.snippet.channelTitle], keyword)
      );
    }

    const sort = String(req.query.sort || "relevance").toLowerCase();
    sortVideos(fullItems, sort);

    const videos = fullItems.map((v) => shapeVideo(v));
    res.json({ videos, count: videos.length });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeySet: !!API_KEY });
});

app.listen(PORT, () => {
  console.log(`YT Data backend running on http://localhost:${PORT}`);
});