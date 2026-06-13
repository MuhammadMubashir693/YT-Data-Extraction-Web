import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseVideoId,
  parseChannelId,
  parseCommentId,
  parsePlaylistId,
  fmtDatetime,
  fmtCountry,
  keywordMatches,
  shapeVideo,
} from "./helpers.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.YT_API_KEY;
const PORT = process.env.PORT || 5000;
const BASE = "https://www.googleapis.com/youtube/v3";

const app = express();
app.use(cors());
app.use(express.json());

if (!API_KEY) {
  console.warn("WARNING: YT_API_KEY is not set. Add it to backend/.env");
}

// Helper to call the YouTube Data API
async function ytFetch(resource, params) {
  const resp = await axios.get(`${BASE}/${resource}`, {
    params: { ...params, key: API_KEY },
  });
  return resp.data;
}

function handleError(res, err) {
  const apiMsg = err?.response?.data?.error?.message;
  res.status(500).json({ error: apiMsg || err.message || "Unknown error" });
}

// ── Load channels.txt ───────────────────────────────────────────────────

function loadChannels() {
  const file = path.join(__dirname, "channels.txt");
  const channels = [];
  if (!fs.existsSync(file)) return channels;
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(":");
    if (idx === -1) continue;
    const name = trimmed.slice(0, idx).trim();
    const id = trimmed.slice(idx + 1).trim();
    channels.push({ name, id });
  }
  return channels;
}

app.get("/api/channels", (req, res) => {
  res.json(loadChannels());
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
      startDate,
      endDate,
      durationFilter, // 'short' | 'medium' | 'long'
    } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

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
    if (mode === "keyword" && keyword) params.q = keyword;

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

    if (mode === "keyword" && keyword) {
      fullItems = fullItems.filter((v) => keywordMatches(v.snippet.title, keyword));
    }

    fullItems.sort((a, b) =>
      a.snippet.publishedAt.localeCompare(b.snippet.publishedAt)
    );

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
      thumb.high?.url || thumb.medium?.url || thumb.default?.url || "N/A";
    const banner = bs.image?.bannerExternalUrl || "N/A";

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

// ── Part 5 – Playlist videos ────────────────────────────────────────────────

app.get("/api/playlist", async (req, res) => {
  try {
    const raw = req.query.q || "";
    const playlistId = parsePlaylistId(raw);
    if (!playlistId) {
      return res.status(400).json({ error: "Could not parse a valid playlist ID from the input." });
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

    fullItems.sort((a, b) =>
      a.snippet.publishedAt.localeCompare(b.snippet.publishedAt)
    );

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
