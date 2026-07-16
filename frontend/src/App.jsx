import React, { useEffect, useState, useMemo } from "react";
import VideoCard from "./VideoCard.jsx";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { useInfiniteScroll } from "./useInfiniteScroll.jsx";
import { fmtCount } from "./format.js";
import {
  addResource,
  deleteResource,
  getResource,
  updateResource,
} from "./localResourceStorage.js";

// ── Client-side video ID parser (mirrors helpers.js) ─────────────────────

function parseVideoId(text) {
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

// ── Client-side video sorting (mirrors backend sortVideos in server.js) ──

function safeNum(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function getDurationSeconds(video) {
  if (!video) return null;
  if (video.duration === "N/A") return null;
  const n = Number(video.durationSeconds);
  return Number.isFinite(n) ? n : null;
}

function sortByDuration(items, direction) {
  return items.sort((a, b) => {
    const aSeconds = getDurationSeconds(a);
    const bSeconds = getDurationSeconds(b);
    if (aSeconds === null && bSeconds === null) return 0;
    if (aSeconds === null) return 1;
    if (bSeconds === null) return -1;
    return (aSeconds - bSeconds) * direction;
  });
}

function sortVideosClient(videos, sort) {
  if (!videos?.length) return videos || [];
  const items = [...videos];
  const direction = sort.endsWith("-asc") ? 1 : -1;
  switch (sort) {
    case "date-asc":
    case "date-desc":
      return items.sort((a, b) => {
        const aTime = a.publishedAtRaw ? new Date(a.publishedAtRaw).getTime() : 0;
        const bTime = b.publishedAtRaw ? new Date(b.publishedAtRaw).getTime() : 0;
        return (aTime - bTime) * direction;
      });
    case "viewCount-asc":
    case "viewCount-desc":
      return items.sort((a, b) => (safeNum(a.views) - safeNum(b.views)) * direction);
    case "rating-asc":
    case "rating-desc":
      return items.sort((a, b) => {
        const aLikes = safeNum(a.likes);
        const bLikes = safeNum(b.likes);
        const aViews = safeNum(a.views);
        const bViews = safeNum(b.views);
        const aScore = aViews ? aLikes / aViews : aLikes;
        const bScore = bViews ? bLikes / bViews : bLikes;
        return (aScore - bScore) * direction;
      });
    case "title-asc":
    case "title-desc":
      return items.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) * direction
      );
    case "duration-asc":
    case "duration-desc":
      return sortByDuration(items, direction);
    default:
      return items;
  }
}

const PAGE_SIZE = 20;

// If the end date is earlier than the start date, swap them — used by any
// start/end date pair so a user entering them in the "incorrect" order still
// gets a sensible range instead of an empty one.
function autoSwapDates(newStart, newEnd, setStart, setEnd) {
  if (newStart && newEnd && newEnd < newStart) {
    setStart(newEnd);
    setEnd(newStart);
  } else {
    setStart(newStart);
    setEnd(newEnd);
  }
}

// Client-side filter: keeps videos whose publish date falls within
// [startDate, endDate] (inclusive), comparing by UTC calendar day. Either
// bound can be blank to leave that side open-ended.
function filterVideosByDateRange(videos, startDate, endDate) {
  if (!startDate && !endDate) return videos;
  return videos.filter((v) => {
    if (!v.publishedAtRaw) return false;
    const day = v.publishedAtRaw.slice(0, 10); // YYYY-MM-DD, comparable as a string
    if (startDate && day < startDate) return false;
    if (endDate && day > endDate) return false;
    return true;
  });
}

// Client-side comment thread filtering (by keyword across thread + loaded
// reply text, and by published date range) — mirrors filterVideosByDateRange
// but for comment threads, so search/date filters apply live without
// re-fetching from the server.
function filterThreadsClient(threads, keyword, startDate, endDate) {
  if (!threads?.length) return threads || [];
  let items = threads;
  const kw = (keyword || "").trim().toLowerCase();
  if (kw) {
    items = items.filter((t) => {
      const threadText = `${t.textDisplay} ${t.textOriginal}`.toLowerCase();
      const replyText = (t.replies || [])
        .map((r) => `${r.textDisplay} ${r.textOriginal}`.toLowerCase())
        .join(" ");
      return threadText.includes(kw) || replyText.includes(kw);
    });
  }
  if (startDate || endDate) {
    items = items.filter((t) => {
      if (!t.publishedAtRaw) return false;
      const day = t.publishedAtRaw.slice(0, 10);
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }
  return items;
}

// Client-side comment thread sorting. "top" preserves whatever order the
// threads were fetched in (relevance, from the API) since that ranking
// can't be reconstructed locally; the rest can be computed live from
// fields already present on each thread, with no refetch needed.
function sortThreadsClient(threads, sort) {
  if (!threads?.length) return threads || [];
  const items = [...threads];
  switch (sort) {
    case "latest":
      return items.sort((a, b) => new Date(b.publishedAtRaw) - new Date(a.publishedAtRaw));
    case "earliest":
      return items.sort((a, b) => new Date(a.publishedAtRaw) - new Date(b.publishedAtRaw));
    case "likes-desc":
      return items.sort((a, b) => Number(b.likeCount) - Number(a.likeCount));
    case "likes-asc":
      return items.sort((a, b) => Number(a.likeCount) - Number(b.likeCount));
    case "top":
    default:
      return items;
  }
}

function ProgressiveList({ items, pageSize = PAGE_SIZE, resetKey, renderItem, loadingLabel = "Loading more...", active = true, manual = false }) {
  const [count, setCount] = useState(pageSize);
  const hasMore = count < items.length;
  const { isNearBottom } = useInfiniteScroll({ enabled: !manual && hasMore && active, threshold: 0.85 });

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  useEffect(() => {
    if (!manual && isNearBottom && hasMore) {
      setCount((c) => Math.min(c + pageSize, items.length));
    }
  }, [isNearBottom, hasMore, pageSize, items.length, manual]);

  return (
    <div>
      {items.slice(0, count).map(renderItem)}
      {hasMore && (
        manual ? (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setCount((c) => Math.min(c + pageSize, items.length))}
            >
              View more
            </button>
          </div>
        ) : (
          <div className="message-box secondary" style={{ marginTop: 10 }}>{loadingLabel}</div>
        )
      )}
    </div>
  );
}

const TABS = [
  { id: "video", label: "Video Details" },
  { id: "player", label: "Video Player" },
  { id: "channelSearch", label: "Search" },
  { id: "channel", label: "Channel Details" },
  { id: "comment", label: "Comment Details" },
  { id: "comments", label: "Comment Threads" },
  { id: "playlist", label: "Playlist Details" },
  { id: "manageChannels", label: "Manage Channels" },
  { id: "manageVideos", label: "Manage Videos" },
  { id: "managePlaylists", label: "Manage Playlists" },
  { id: "manageComments", label: "Manage Comments" },
];

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/${path}${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request couldn't be processed");
  }
  return data;
}

// ── Saved-items change broadcasting ──────────────────────────────────────
//
// Several tabs (Search, Channel Details, and any tab using useSavedItems)
// each load their own copy of the saved channels/videos/playlists/comments
// lists once on mount. Without something tying them together, adding,
// updating, or deleting an entry in a Manage tab only updates that tab's
// own list — every other tab keeps showing stale data until the page is
// reloaded. To fix that without a big state-lifting refactor, a Manage tab
// broadcasts a small event any time its list actually changes (whether the
// change went to MongoDB or fell back to localStorage), and any component
// that reads the same resource listens for that event and re-fetches.
const SAVED_ITEMS_CHANGED_EVENT = "saved-items-changed";

function broadcastSavedItemsChanged(apiPath) {
  window.dispatchEvent(new CustomEvent(SAVED_ITEMS_CHANGED_EVENT, { detail: { apiPath } }));
}

function useSavedItemsChangedListener(apiPath, onChange) {
  // Keep a ref to the latest callback so the listener always invokes the
  // current render's closure (with up-to-date state) rather than whichever
  // one happened to be in scope when the listener was first attached.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.apiPath === apiPath) onChangeRef.current();
    };
    window.addEventListener(SAVED_ITEMS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SAVED_ITEMS_CHANGED_EVENT, handler);
  }, [apiPath]);
}

// A network-level failure (no response at all — DNS error, connection
// refused, offline, etc.) is the only case that should fall back to
// localStorage. A response that came back but reported an application
// error (400/404/409, e.g. "duplicate id") is not a "backend unavailable"
// situation and must be surfaced to the user as-is, not silently swallowed
// into a local write.
async function submitManagedResource(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    const err = new Error(networkErr.message || "Network error");
    err.isNetworkFailure = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request couldn't be processed");
    err.isNetworkFailure = false;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Export helpers (JSON / XML / CSV / TXT) ─────────────────────────────

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function asRecordArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

function flattenValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toCSV(data) {
  const rows = asRecordArray(data);
  if (!rows.length) return "";
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );
  const escapeCell = (val) => {
    const str = flattenValue(val);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [columns.map(escapeCell).join(",")];
  rows.forEach((row) => {
    lines.push(columns.map((col) => escapeCell(row?.[col])).join(","));
  });
  return lines.join("\n");
}

function escapeXML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlNode(name, value, indent) {
  const pad = "  ".repeat(indent);
  const safeName = /^[A-Za-z_][\w.-]*$/.test(name) ? name : `field_${name}`.replace(/[^\w.-]/g, "_");
  if (value === null || value === undefined) {
    return `${pad}<${safeName} />`;
  }
  if (Array.isArray(value)) {
    const inner = value
      .map((item) => xmlNode("item", item, indent + 1))
      .join("\n");
    return `${pad}<${safeName}>\n${inner}\n${pad}</${safeName}>`;
  }
  if (typeof value === "object") {
    const inner = Object.entries(value)
      .map(([k, v]) => xmlNode(k, v, indent + 1))
      .join("\n");
    return `${pad}<${safeName}>\n${inner}\n${pad}</${safeName}>`;
  }
  return `${pad}<${safeName}>${escapeXML(value)}</${safeName}>`;
}

function toXML(data, rootName = "results") {
  const rows = asRecordArray(data);
  const inner = rows.map((row) => xmlNode("item", row, 1)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}>\n${inner}\n</${rootName}>`;
}

function flattenForText(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      lines.push(`${pad}[${i}]`);
      lines.push(...flattenForText(item, indent + 1));
    });
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([k, v]) => {
      if (v && typeof v === "object") {
        lines.push(`${pad}${k}:`);
        lines.push(...flattenForText(v, indent + 1));
      } else {
        lines.push(`${pad}${k}: ${flattenValue(v)}`);
      }
    });
  } else {
    lines.push(`${pad}${flattenValue(value)}`);
  }
  return lines;
}

function toTXT(data) {
  const rows = asRecordArray(data);
  return rows
    .map((row, i) => {
      const lines = flattenForText(row, 0);
      return `── Item ${i + 1} ──\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function exportData(data, format, filenameBase) {
  const rows = asRecordArray(data);
  if (!rows.length) return;
  let content;
  let mimeType;
  let ext;
  switch (format) {
    case "json":
      content = JSON.stringify(rows, null, 2);
      mimeType = "application/json";
      ext = "json";
      break;
    case "xml":
      content = toXML(rows, "results");
      mimeType = "application/xml";
      ext = "xml";
      break;
    case "csv":
      content = toCSV(rows);
      mimeType = "text/csv";
      ext = "csv";
      break;
    case "txt":
      content = toTXT(rows);
      mimeType = "text/plain";
      ext = "txt";
      break;
    default:
      return;
  }
  downloadFile(`${filenameBase}.${ext}`, content, mimeType);
}

function ExportBar({ data, filenameBase }) {
  const rows = asRecordArray(data);
  if (!rows.length) return null;
  return (
    <div className="row export-bar" style={{ gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
      <span style={{ fontsize: 14, opacity: 0.65, alignSelf: "center" }}>Export results:</span>
      {["json", "xml", "csv", "txt"].map((format) => (
        <button
          key={format}
          type="button"
          className="secondary"
          onClick={() => exportData(rows, format, filenameBase)}
        >
          {format.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ErrorBox({ message, type = "error" }) {
  if (!message) return null;
  return <div className={`message-box ${type}`}>{message}</div>;
}

function Spinner() {
  return <span className="spinner" />;
}

// Loads saved entries (channels/videos/playlists/comments) from the backend,
// falling back to localStorage when the backend is unreachable — same
// pattern used by ChannelTab's "select saved channel" dropdown, generalized
// so every lookup tab can offer the same convenience.
function useSavedItems(apiPath, storageKey) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet(apiPath);
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setItems(getResource(storageKey));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSavedItemsChangedListener(apiPath, () => {
    apiGet(apiPath)
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems(getResource(storageKey)));
  });

  return { items, loaded };
}

// Dropdown that lets the person pick one of their saved entries to populate
// an ID/URL input field, mirroring the "Select saved channel" dropdown.
function SavedItemSelect({ items, loaded, onSelect, label, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
        disabled={!loaded}
      >
        <option value="">{placeholder}</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name} ({it.id})
          </option>
        ))}
      </select>
      {!loaded && <span className="spinner" />}
    </div>
  );
}

// Category filters ("all" / "standard" / "shorts" / "live") support
// multi-select: clicking a second specific category adds it alongside the
// first; clicking a selected category again removes it (falling back to
// "all" if nothing is left selected); selecting every specific category
// collapses back to "all"; and "all" is mutually exclusive with everything
// else, so picking it — or picking a specific category while "all" is
// active — resets the selection to just that click.
function toggleCategoryFilter(setFilter, clicked) {
  setFilter((prev) => {
    if (clicked === "all") return new Set(["all"]);
    if (prev.has("all")) return new Set([clicked]);
    const next = new Set(prev);
    if (next.has(clicked)) {
      next.delete(clicked);
      if (next.size === 0) return new Set(["all"]);
    } else {
      next.add(clicked);
      if (next.size === 3) return new Set(["all"]);
    }
    return next;
  });
}

function matchesCategoryFilter(categoryFilter, { isStandard, isShort, isLive }) {
  if (categoryFilter.has("all")) return true;
  return (
    (isStandard && categoryFilter.has("standard")) ||
    (isShort && categoryFilter.has("shorts")) ||
    (isLive && categoryFilter.has("live"))
  );
}

function CategoryFilterButtons({ categoryFilter, setCategoryFilter, counts }) {
  return (
    <div className="row" style={{ gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
      <button
        type="button"
        className={`category-btn ${categoryFilter.has("all") ? "active" : ""}`}
        onClick={() => toggleCategoryFilter(setCategoryFilter, "all")}
      >
        All ({counts.all})
      </button>
      <button
        type="button"
        className={`category-btn ${categoryFilter.has("standard") ? "active" : ""}`}
        onClick={() => toggleCategoryFilter(setCategoryFilter, "standard")}
      >
        Standard ({counts.standard})
      </button>
      <button
        type="button"
        className={`category-btn ${categoryFilter.has("shorts") ? "active" : ""}`}
        onClick={() => toggleCategoryFilter(setCategoryFilter, "shorts")}
      >
        Shorts ({counts.shorts})
      </button>
      <button
        type="button"
        className={`category-btn ${categoryFilter.has("live") ? "active" : ""}`}
        onClick={() => toggleCategoryFilter(setCategoryFilter, "live")}
      >
        Live ({counts.live})
      </button>
    </div>
  );
}

// ── Tab: Single Video Details ────────────────────────────────────────────

function VideoTab() {
  const [input, setInput] = useState("");
  const [video, setVideo] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { items: savedVideos, loaded: savedVideosLoaded } = useSavedItems("videos", "yt-data-saved-videos");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setVideo(null);
    setLoading(true);
    try {
      const data = await apiGet("video", { q: input });
      setVideo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <SavedItemSelect
          items={savedVideos}
          loaded={savedVideosLoaded}
          onSelect={setInput}
          label="Select saved video"
          placeholder="-- Choose a saved video --"
        />
        <div className="field">
          <label>Video ID or URL</label>
          <input
            type="text"
            placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Fetch Video
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => {
              setInput("");
              setVideo(null);
              setError("");
            }}
          >
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {video && (
        <div style={{ marginTop: 16 }}>
          <ExportBar data={video} filenameBase="video-details" />
          <VideoCard v={video} showTags />
        </div>
      )}
    </div>
  );
}

// ── Tab: Search ─────────────────────────────────────────────────────────

function ChannelResultCard({ ch }) {
  return (
    <div className="video-card">
      {ch.thumbnail && (
        <ImageWithFallback src={ch.thumbnail} alt={ch.title} loading="lazy" />
      )}
      <div className="body">
        <p className="title">
          <a href={ch.channelUrl} target="_blank" rel="noreferrer">{ch.title}</a>
        </p>
        <div className="meta-grid">
          <span><b>Channel ID:</b> {ch.channelId}</span>
          <span><b>Subscribers:</b> {fmtCount(ch.subscribers)}</span>
          <span><b>Videos:</b> {fmtCount(ch.videoCount)}</span>
          <span><b>Total views:</b> {fmtCount(ch.viewCount)}</span>
          <span><b>Country:</b> {ch.country}</span>
          <span><b>Created:</b> {ch.publishedAt}</span>
        </div>
        {ch.description && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
            <LinkifiedText text={ch.description} />
          </div>
        )}
      </div>
    </div>
  );
}

function PlaylistResultCard({ pl }) {
  return (
    <div className="video-card">
      {pl.thumbnail && (
        <ImageWithFallback src={pl.thumbnail} alt={pl.title} loading="lazy" />
      )}
      <div className="body">
        <p className="title">
          <a href={pl.playlistUrl} target="_blank" rel="noreferrer">{pl.title}</a>
        </p>
        <div className="meta-grid">
          <span><b>Playlist ID:</b> {pl.playlistId}</span>
          <span><b>Channel:</b> {pl.channelTitle}</span>
          <span><b>Channel ID:</b> {pl.channelId}</span>
          <span><b>Videos:</b> {fmtCount(pl.videoCount)}</span>
          <span><b>Created:</b> {pl.publishedAt}</span>
        </div>
      </div>
    </div>
  );
}

function ChannelSearchTab() {
  // Category: 'video' | 'channel' | 'playlist'
  const [category, setCategory] = useState("video");

  // Video search state
  const [searchType, setSearchType] = useState("channel"); // 'channel' | 'general'
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState("");
  const [useCustomChannel, setUseCustomChannel] = useState(false);
  const [customChannelId, setCustomChannelId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [usePerFieldKeywords, setUsePerFieldKeywords] = useState(false);
  const [keywordTitle, setKeywordTitle] = useState("");
  const [keywordDescription, setKeywordDescription] = useState("");
  const [keywordChannel, setKeywordChannel] = useState("");
  const [matchMode, setMatchMode] = useState("every");
  const [sortOption, setSortOption] = useState("relevance");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useDateRange, setUseDateRange] = useState(false);
  const [useDuration, setUseDuration] = useState(false);
  const [durationFilter, setDurationFilter] = useState("medium");
  const [liveFilter, setLiveFilter] = useState(false);

  // Channel search state
  const [chKeyword, setChKeyword] = useState("");

  // Playlist search state
  const [plKeyword, setPlKeyword] = useState("");
  const [plUsePerField, setPlUsePerField] = useState(false);
  const [plKeywordTitle, setPlKeywordTitle] = useState("");
  const [plKeywordChannel, setPlKeywordChannel] = useState("");

  // Shared max results
  const [maxResults, setMaxResults] = useState("50");

  // Results
  const [videos, setVideos] = useState(null);
  const [channelResults, setChannelResults] = useState(null);
  const [playlistResults, setPlaylistResults] = useState(null);
  const [channelNextToken, setChannelNextToken] = useState(null);
  const [channelPrevToken, setChannelPrevToken] = useState(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sortedVideos = videos ? sortVideosClient(videos, sortOption) : null;

  const [categoryFilter, setCategoryFilter] = useState(() => new Set(["all"]));

  // ── Sync live checkbox with category filter ──
  useEffect(() => {
    setCategoryFilter(new Set([liveFilter ? "live" : "all"]));
  }, [liveFilter]);

  const displayedVideos = useMemo(() => {
    if (!sortedVideos) return [];
    return sortedVideos.filter(v => {
      const isLive = !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime);
      const isShort = !isLive && v.durationSeconds !== null && v.durationSeconds <= 180;
      const isStandard = !isLive && !isShort;
      return matchesCategoryFilter(categoryFilter, { isStandard, isShort, isLive });
    });
  }, [sortedVideos, categoryFilter]);

  const counts = useMemo(() => {
    if (!sortedVideos) return { all: 0, standard: 0, shorts: 0, live: 0 };
    const all = sortedVideos.length;
    const live = sortedVideos.filter(v => !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime)).length;
    const shorts = sortedVideos.filter(v => !(v.scheduledStartTime || v.actualStartTime || v.actualEndTime) && v.durationSeconds !== null && v.durationSeconds <= 180).length;
    const standard = all - live - shorts;
    return { all, standard, shorts, live };
  }, [sortedVideos]);

  const refreshChannels = async () => {
    try {
      const data = await apiGet("channels");
      setChannels(data);
      if (data.length) {
        if (!data.some((c) => c.id === channelId)) {
          setChannelId(data[0].id);
        }
      } else {
        setChannelId("");
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshChannels();
  }, []);

  useSavedItemsChangedListener("channels", refreshChannels);

  const clearResults = () => {
    setVideos(null);
    setChannelResults(null);
    setPlaylistResults(null);
    setChannelNextToken(null);
    setChannelPrevToken(null);
    setError("");
  };

  const resetAll = () => {
    clearResults();
    setSearchType("channel");
    setUseCustomChannel(false);
    setCustomChannelId("");
    setKeyword("");
    setUsePerFieldKeywords(false);
    setKeywordTitle("");
    setKeywordDescription("");
    setKeywordChannel("");
    setMatchMode("every");
    setSortOption("relevance");
    setStartDate("");
    setEndDate("");
    setUseDateRange(false);
    setUseDuration(false);
    setDurationFilter("medium");
    setChKeyword("");
    setPlKeyword("");
    setPlUsePerField(false);
    setPlKeywordTitle("");
    setPlKeywordChannel("");
    setMaxResults("50");
    setLiveFilter(false);
    setCategoryFilter(new Set(["all"]));
  };

  const submit = async (e) => {
    e.preventDefault();
    clearResults();
    setLoading(true);
    try {
      if (category === "video") {
        const isChannelSearch = searchType === "channel";
        if (isChannelSearch) {
          const resolvedChannelId = useCustomChannel ? customChannelId.trim() : channelId;
          const params = { channelId: resolvedChannelId, mode: "keyword", matchMode };
          if (usePerFieldKeywords) {
            if (keywordTitle.trim()) params.keywordTitle = keywordTitle.trim();
            if (keywordDescription.trim()) params.keywordDescription = keywordDescription.trim();
            if (keywordChannel.trim()) params.keywordChannel = keywordChannel.trim();
          } else {
            params.keyword = keyword;
          }
          if (useDateRange) {
            params.startDate = startDate;
            params.endDate = endDate;
          }
          if (useDuration) params.durationFilter = durationFilter;
          if (sortOption) params.sort = sortOption;
          params.maxResults = maxResults;
          const data = await apiGet("channel-videos", params);
          setVideos(data.videos);
        } else {
          const hasPerField = usePerFieldKeywords && (keywordTitle.trim() || keywordDescription.trim() || keywordChannel.trim());
          const hasKeyword = usePerFieldKeywords ? hasPerField : Boolean(keyword.trim());
          const hasDateRange = useDateRange && Boolean(startDate || endDate);
          if (!hasKeyword && !hasDateRange && !useDuration) {
            throw new Error("Provide a keyword, date range, or duration type to search");
          }
          const params = { sort: sortOption, maxResults, matchMode };
          if (usePerFieldKeywords) {
            if (keywordTitle.trim()) params.keywordTitle = keywordTitle.trim();
            if (keywordDescription.trim()) params.keywordDescription = keywordDescription.trim();
            if (keywordChannel.trim()) params.keywordChannel = keywordChannel.trim();
          } else {
            params.keyword = keyword;
          }
          if (startDate) params.startDate = startDate;
          if (endDate) params.endDate = endDate;
          if (useDuration) params.durationFilter = durationFilter;
          const data = await apiGet("search-videos", params);
          setVideos(data.videos);
        }
      } else if (category === "channel") {
        if (!chKeyword.trim()) throw new Error("Keyword is required for channel search");
        const params = { keyword: chKeyword.trim(), maxResults };
        const data = await apiGet("search-channels", params);
        setChannelResults(data.channels);
        setChannelNextToken(data.nextPageToken || null);
        setChannelPrevToken(data.prevPageToken || null);
      } else {
        const hasPerField = plUsePerField && (plKeywordTitle.trim() || plKeywordChannel.trim());
        if (!plUsePerField && !plKeyword.trim()) throw new Error("Keyword is required for playlist search");
        if (plUsePerField && !hasPerField) throw new Error("At least one per-field keyword is required");
        const params = { maxResults };
        if (plUsePerField) {
          if (plKeywordTitle.trim()) params.keywordTitle = plKeywordTitle.trim();
          if (plKeywordChannel.trim()) params.keywordChannel = plKeywordChannel.trim();
        } else {
          params.keyword = plKeyword.trim();
        }
        const data = await apiGet("search-playlists", params);
        setPlaylistResults(data.playlists);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pages forward/backward through channel search results using YouTube's
  // own nextPageToken/prevPageToken (only meaningful when maxResults ≤ 50,
  // i.e. a single search page — see /api/search-channels).
  const goToChannelPage = async (pageToken) => {
    if (!pageToken || loading) return;
    setError("");
    setLoading(true);
    try {
      const params = { keyword: chKeyword.trim(), maxResults, pageToken };
      const data = await apiGet("search-channels", params);
      setChannelResults(data.channels);
      setChannelNextToken(data.nextPageToken || null);
      setChannelPrevToken(data.prevPageToken || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isChannelSearch = searchType === "channel";

  // Validate max results
  const maxNum = Number(maxResults);
  const maxResultsInvalid = !maxResults || maxNum < 50 || maxNum > 500;

  const isDisabled = (() => {
    if (loading) return true;
    if (maxResultsInvalid) return true;
    if (category === "video") {
      if (isChannelSearch && !useCustomChannel && !channelId) return true;
      if (isChannelSearch && useCustomChannel && !customChannelId.trim()) return true;
      const hasKeyword = usePerFieldKeywords
        ? Boolean(keywordTitle.trim() || keywordDescription.trim() || keywordChannel.trim())
        : Boolean(keyword.trim());
      const hasDateRange = useDateRange && Boolean(startDate || endDate);
      const hasDurationFilter = useDuration;
      if (!hasKeyword && !hasDateRange && !hasDurationFilter) return true;
    } else if (category === "channel") {
      if (!chKeyword.trim()) return true;
    } else {
      if (plUsePerField && !plKeywordTitle.trim() && !plKeywordChannel.trim()) return true;
      if (!plUsePerField && !plKeyword.trim()) return true;
    }
    return false;
  })();

  // ── Keyword fields shared between channel-search and general-search ───
  // Rendered identically in both branches, extracted here to avoid duplication.
  const keywordFields = (
    <>
      <label className="checkbox-row">
        <input type="checkbox" checked={usePerFieldKeywords} onChange={(e) => setUsePerFieldKeywords(e.target.checked)} />
        Specify separate keywords per field
      </label>
      {usePerFieldKeywords ? (
        <>
          <div className="field">
            <label>Title keyword</label>
            <input type="text" placeholder="Leave empty to ignore" value={keywordTitle} onChange={(e) => setKeywordTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Description keyword</label>
            <input type="text" placeholder="Leave empty to ignore" value={keywordDescription} onChange={(e) => setKeywordDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Channel name keyword</label>
            <input type="text" placeholder="Leave empty to ignore" value={keywordChannel} onChange={(e) => setKeywordChannel(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="field">
          <label>Keyword</label>
          <input type="text" placeholder="e.g. tutorial" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={matchMode === "some"}
          onChange={(e) => setMatchMode(e.target.checked ? "some" : "every")}
        />
        Match any word (instead of all words)
      </label>
      <div className="field">
        <label>Sort by</label>
        <select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
          <option value="relevance">Relevance</option>
          <option value="date-desc">Date (newest first)</option>
          <option value="date-asc">Date (oldest first)</option>
          <option value="viewCount-desc">View count (highest first)</option>
          <option value="viewCount-asc">View count (lowest first)</option>
          <option value="rating-desc">Rating (highest first)</option>
          <option value="rating-asc">Rating (lowest first)</option>
          <option value="title-asc">Title (A → Z)</option>
          <option value="title-desc">Title (Z → A)</option>
          <option value="duration-desc">Duration (longest first)</option>
          <option value="duration-asc">Duration (shortest first)</option>
        </select>
      </div>
    </>
  );

  return (
    <div className="panel">
      <form onSubmit={submit}>

        {/* ── Category selector ── */}
        <div className="field">
          <label>Search for</label>
          <select value={category} onChange={(e) => { setCategory(e.target.value); clearResults(); }}>
            <option value="video">Videos</option>
            <option value="channel">Channels</option>
            <option value="playlist">Playlists</option>
          </select>
        </div>

        {/* ══ VIDEO fields ══ */}
        {category === "video" && (
          <>
            <div className="field">
              <label>Search type</label>
              <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>
                <option value="channel">Search within channel</option>
                <option value="general">Search generally</option>
              </select>
            </div>

            {/* ── Channel selector ── */}
            {isChannelSearch && (
              <div className="field">
                <label>Channel</label>
                <label className="checkbox-row" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={useCustomChannel}
                    onChange={(e) => {
                      setUseCustomChannel(e.target.checked);
                      setCustomChannelId("");
                    }}
                  />
                  Specify a custom channel ID
                </label>
                {useCustomChannel ? (
                  <input
                    type="text"
                    placeholder="Enter channel ID manually (e.g. UCxxxxxxxxxxxxxxxxxxxxxx)"
                    value={customChannelId}
                    onChange={(e) => setCustomChannelId(e.target.value)}
                  />
                ) : channels.length ? (
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                    ))}
                  </select>
                ) : (
                  <p style={{ margin: 0, opacity: 0.6, fontsize: 14 }}>
                    No saved channels. Add some in the <b>Manage Channels</b> tab, or check the box above to enter an ID manually.
                  </p>
                )}
              </div>
            )}

            {/* ── Keyword fields (channel search) ── */}
            {isChannelSearch && (
              <>
                {keywordFields}
                <label className="checkbox-row">
                  <input type="checkbox" checked={useDateRange} onChange={(e) => setUseDateRange(e.target.checked)} />
                  Filter by date range
                </label>
              </>
            )}

            {/* ── Keyword fields (general search) ── */}
            {!isChannelSearch && keywordFields}

            {/* ── Date range inputs ── */}
            {((!isChannelSearch) || (isChannelSearch && useDateRange)) && (
              <div className="row">
                <div className="field">
                  <label>Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => autoSwapDates(e.target.value, endDate, setStartDate, setEndDate)}
                  />
                </div>
                <div className="field">
                  <label>End date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => autoSwapDates(startDate, e.target.value, setStartDate, setEndDate)}
                  />
                </div>
              </div>
            )}

            <label className="checkbox-row">
              <input type="checkbox" checked={useDuration} onChange={(e) => setUseDuration(e.target.checked)} />
              Filter by duration type
            </label>
            {useDuration && (
              <div className="field">
                <label>Duration</label>
                <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value)}>
                  <option value="short">Short (&lt; 4 min)</option>
                  <option value="medium">Medium (4–20 min)</option>
                  <option value="long">Long (&gt; 20 min)</option>
                </select>
              </div>
            )}

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={liveFilter}
                onChange={(e) => setLiveFilter(e.target.checked)}
              />
              Live
            </label>
          </>
        )}

        {/* ══ CHANNEL fields ══ */}
        {category === "channel" && (
          <div className="field">
            <label>Channel name keyword</label>
            <input type="text" placeholder="Search by channel name" value={chKeyword} onChange={(e) => setChKeyword(e.target.value)} />
          </div>
        )}

        {/* ══ PLAYLIST fields ══ */}
        {category === "playlist" && (
          <>
            <label className="checkbox-row">
              <input type="checkbox" checked={plUsePerField} onChange={(e) => setPlUsePerField(e.target.checked)} />
              Specify separate keywords per field
            </label>
            {plUsePerField ? (
              <>
                <div className="field">
                  <label>Playlist title keyword</label>
                  <input type="text" placeholder="Leave empty to ignore" value={plKeywordTitle} onChange={(e) => setPlKeywordTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label>Channel title keyword</label>
                  <input type="text" placeholder="Leave empty to ignore" value={plKeywordChannel} onChange={(e) => setPlKeywordChannel(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="field">
                <label>Keyword</label>
                <input type="text" placeholder="e.g. cooking basics" value={plKeyword} onChange={(e) => setPlKeyword(e.target.value)} />
              </div>
            )}
          </>
        )}

        {/* ── Max results (shared) ── */}
        <div className="field">
          <label>Max results</label>
          <select
            value={["50", "250", "500"].includes(maxResults) ? maxResults : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") setMaxResults(e.target.value);
              else setMaxResults("");
            }}
          >
            <option value="50">50</option>
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="custom">Custom...</option>
          </select>
          {!["50", "250", "500"].includes(maxResults) && (
            <div style={{ marginTop: 6 }}>
              <input
                type="number"
                min={50}
                max={500}
                placeholder="Enter a value between 50 and 500"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                style={{ width: "100%" }}
              />
              {maxResults !== "" && (Number(maxResults) < 50 || Number(maxResults) > 500) && (
                <div className="message-box error" style={{ marginTop: 6 }}>
                  Max results must be between 50 and 500 inclusive.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={isDisabled}>
            {loading && <Spinner />}
            Search
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={resetAll}>
            Reset
          </button>
        </div>
      </form>

      <ErrorBox message={error} />

      {videos && (
        <>
          <p className="result-count">Result count: {fmtCount(videos.length)}</p>
          <ExportBar data={displayedVideos} filenameBase="video-search-results" />

          {/* Category buttons */}
          {!liveFilter && (
            <CategoryFilterButtons categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} counts={counts} />
          )}

          <p className="result-count" style={{ marginTop: 0 }}>
            {categoryFilter.has("all")
              ? `Total videos: ${fmtCount(sortedVideos.length)}`
              : `Showing ${fmtCount(displayedVideos.length)} of ${fmtCount(sortedVideos.length)} videos`}
          </p>

          {displayedVideos.map(({ description: _desc, ...v }) => (
            <VideoCard key={v.videoId} v={v} />
          ))}
        </>
      )}

      {channelResults && (
        <>
          <p className="result-count">Result count: {fmtCount(channelResults.length)}</p>
          <ExportBar data={channelResults} filenameBase="channel-search-results" />
          {channelResults.map((ch) => (
            <ChannelResultCard key={ch.channelId} ch={ch} />
          ))}
          {(channelPrevToken || channelNextToken) && (
            <div className="row" style={{ gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                disabled={!channelPrevToken || loading}
                onClick={() => goToChannelPage(channelPrevToken)}
              >
                {loading && <Spinner />}
                Previous Page
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!channelNextToken || loading}
                onClick={() => goToChannelPage(channelNextToken)}
              >
                {loading && <Spinner />}
                Next Page
              </button>
            </div>
          )}
        </>
      )}

      {playlistResults && (
        <>
          <p className="result-count">Result count: {fmtCount(playlistResults.length)}</p>
          <ExportBar data={playlistResults} filenameBase="playlist-search-results" />
          {playlistResults.map((pl) => (
            <PlaylistResultCard key={pl.playlistId} pl={pl} />
          ))}
        </>
      )}
    </div>
  );
}

// Generic "manage saved <resource>" tab: a name+id CRUD list backed by a
// MongoDB-backed API endpoint, with a localStorage fallback (scoped by
// `storageKey`) when the backend is unreachable. Used for Manage Channels,
// Manage Videos, Manage Playlists, and Manage Comments, which only differ in
// labels, API path, and where fallback data is stored.
function ManagedResourceTab({
  title,
  apiPath,
  storageKey,
  entityLabel, // e.g. "channel", "video", "playlist", "comment"
  idLabel, // e.g. "Channel ID", "Video ID"
  exportFilenameBase,
}) {
  const [items, setItems] = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");
  const [loading, setLoading] = useState(false);

  const refreshItems = async () => {
    try {
      const data = await apiGet(apiPath);
      const resolved = Array.isArray(data) ? data : [];
      setItems(resolved);
      setItemsLoaded(true);
      if (resolved.length && !resolved.some((c) => c.id === selectedId)) {
        setSelectedId("");
        setName("");
        setId("");
      }
    } catch {
      const fallback = getResource(storageKey);
      setItems(fallback);
      setItemsLoaded(true);
      if (fallback.length && !fallback.some((c) => c.id === selectedId)) {
        setSelectedId("");
        setName("");
        setId("");
      }
    }
  };

  useEffect(() => {
    refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectItem = (itemId) => {
    const item = items.find((c) => c.id === itemId);
    if (item) {
      setSelectedId(item.id);
      setName(item.name);
      setId(item.id);
    } else {
      setSelectedId("");
      setName("");
      setId("");
    }
  };

  const notify = (msg, type = "error") => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(""), 4000);
  };

  const createItem = async () => {
    setLoading(true);
    try {
      const data = await submitManagedResource(`/api/${apiPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), id: id.trim() }),
      });
      await refreshItems();
      setSelectedId(data.id);
      setName(data.name);
      setId(data.id);
      broadcastSavedItemsChanged(apiPath);
      notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} added successfully.`, "success");
    } catch (err) {
      if (!err.isNetworkFailure) {
        // The backend is reachable and rejected the request (e.g. duplicate
        // id) — show the real reason instead of masking it as a local save.
        notify(err.message || `Couldn't add ${entityLabel}.`);
        setLoading(false);
        return;
      }
      try {
        const fallbackItem = { name: name.trim(), id: id.trim() };
        const fallback = addResource(fallbackItem, storageKey);
        setItems(fallback);
        setSelectedId(fallbackItem.id);
        setName(fallbackItem.name);
        setId(fallbackItem.id);
        broadcastSavedItemsChanged(apiPath);
        notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} saved locally because the backend is unavailable.`, "success");
      } catch (localErr) {
        notify(localErr.message || `Couldn't add ${entityLabel}.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const updateItem = async () => {
    if (!selectedId) {
      return notify(`Select a ${entityLabel} to update.`);
    }
    setLoading(true);
    try {
      const data = await submitManagedResource(`/api/${apiPath}/${encodeURIComponent(selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), id: id.trim() }),
      });
      await refreshItems();
      setSelectedId(data.id);
      setName(data.name);
      setId(data.id);
      broadcastSavedItemsChanged(apiPath);
      notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} updated successfully.`, "success");
    } catch (err) {
      if (!err.isNetworkFailure) {
        notify(err.message || `Couldn't update ${entityLabel}.`);
        setLoading(false);
        return;
      }
      try {
        const updated = updateResource(selectedId, { name: name.trim(), id: id.trim() }, storageKey);
        setItems(updated);
        setSelectedId(id.trim());
        setName(name.trim());
        setId(id.trim());
        broadcastSavedItemsChanged(apiPath);
        notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} updated locally because the backend is unavailable.`, "success");
      } catch (localErr) {
        notify(localErr.message || `Couldn't update ${entityLabel}.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async () => {
    if (!selectedId) {
      return notify(`Select a ${entityLabel} to delete.`);
    }
    setLoading(true);
    try {
      await submitManagedResource(`/api/${apiPath}/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      await refreshItems();
      setSelectedId("");
      setName("");
      setId("");
      broadcastSavedItemsChanged(apiPath);
      notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} deleted successfully.`, "success");
    } catch (err) {
      if (!err.isNetworkFailure) {
        notify(err.message || `Couldn't delete ${entityLabel}.`);
        setLoading(false);
        return;
      }
      const updated = deleteResource(selectedId, storageKey);
      setItems(updated);
      setSelectedId("");
      setName("");
      setId("");
      broadcastSavedItemsChanged(apiPath);
      notify(`${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} removed locally because the backend is unavailable.`, "success");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h2>{title}</h2>
      {itemsLoaded && items.length > 0 && (
        <ExportBar data={items} filenameBase={exportFilenameBase} />
      )}
      <div className="field">
        <label>Saved {entityLabel}s</label>
        <select value={selectedId} onChange={(e) => selectItem(e.target.value)}>
          <option value="">-- Select saved {entityLabel} --</option>
          {items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>{entityLabel[0].toUpperCase()}{entityLabel.slice(1)} name</label>
        <input
          type="text"
          placeholder="Name to display in dropdown"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>{idLabel}</label>
        <input
          type="text"
          placeholder={idLabel}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="secondary"
          onClick={createItem}
          disabled={loading || !name.trim() || !id.trim()}
        >
          Add
        </button>
        <button
          type="button"
          className="secondary"
          onClick={updateItem}
          disabled={loading || !selectedId || !name.trim() || !id.trim()}
        >
          Update
        </button>
        <button
          type="button"
          className="secondary"
          onClick={deleteItem}
          disabled={loading || !selectedId}
        >
          Delete
        </button>
      </div>
      {message && <ErrorBox message={message} type={messageType} />}
    </div>
  );
}

function ChannelManagerTab() {
  return (
    <ManagedResourceTab
      title="Manage Channels"
      apiPath="channels"
      storageKey="yt-data-saved-channels"
      entityLabel="channel"
      idLabel="Channel ID"
      exportFilenameBase="saved-channels"
    />
  );
}

function VideoManagerTab() {
  return (
    <ManagedResourceTab
      title="Manage Videos"
      apiPath="videos"
      storageKey="yt-data-saved-videos"
      entityLabel="video"
      idLabel="Video ID"
      exportFilenameBase="saved-videos"
    />
  );
}

function PlaylistManagerTab() {
  return (
    <ManagedResourceTab
      title="Manage Playlists"
      apiPath="playlists"
      storageKey="yt-data-saved-playlists"
      entityLabel="playlist"
      idLabel="Playlist ID"
      exportFilenameBase="saved-playlists"
    />
  );
}

function CommentManagerTab() {
  return (
    <ManagedResourceTab
      title="Manage Comments"
      apiPath="saved-comments"
      storageKey="yt-data-saved-comments"
      entityLabel="comment"
      idLabel="Comment ID"
      exportFilenameBase="saved-comments"
    />
  );
}

// ── Tab: Channel Details ─────────────────────────────────────────────────

function ChannelTab({ active = true }) {
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlistSort, setPlaylistSort] = useState("date-desc");
  const [plTitleSearch, setPlTitleSearch] = useState("");
  const [plStartDate, setPlStartDate] = useState("");
  const [plEndDate, setPlEndDate] = useState("");
  const [playlists, setPlaylists] = useState(null);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState("");

  const [latestCount, setLatestCount] = useState(10);
  const [latestVideos, setLatestVideos] = useState(null);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState("");
  const [latestNextToken, setLatestNextToken] = useState(null);
  const [latestPrevToken, setLatestPrevToken] = useState(null);

  const [channels, setChannels] = useState([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState(() => new Set(["all"]));

  const loadSavedChannels = async () => {
    try {
      const data = await apiGet("channels");
      setChannels(Array.isArray(data) ? data : []);
    } catch {
      // Fallback to local storage if backend is unavailable
      const local = getResource();
      setChannels(local);
    } finally {
      setChannelsLoaded(true);
    }
  };

  useEffect(() => {
    loadSavedChannels();
  }, []);

  useSavedItemsChangedListener("channels", loadSavedChannels);


  const handleChannelSelect = (e) => {
    const selectedId = e.target.value;
    if (selectedId) {
      setInput(selectedId);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setChannel(null);
    setLoading(true);
    setLatestVideos(null);
    setLatestError("");
    setLatestNextToken(null);
    setLatestPrevToken(null);
    setPlaylists(null);
    setPlaylistsError("");
    try {
      const data = await apiGet("channel", { q: input });
      setChannel(data);
      setPlaylistSort("date-desc");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setInput("");
    setChannel(null);
    setError("");
    setPlaylistSort("date-desc");
    setLatestVideos(null);
    setLatestError("");
    setLatestCount(10);
    setLatestNextToken(null);
    setLatestPrevToken(null);
    setPlaylists(null);
    setPlaylistsError("");
    setPlaylistsLoading(false);
  };

  const fetchPlaylists = async () => {
    if (!channel?.channelId || playlistsLoading) return;
    setPlaylistsError("");
    setPlaylistsLoading(true);
    try {
      const data = await apiGet("channel-playlists", { channelId: channel.channelId });
      setPlaylists(data.playlists || []);
      setPlaylistSort("date-desc");
      setPlTitleSearch("");
      setPlStartDate("");
      setPlEndDate("");
    } catch (err) {
      setPlaylistsError(err.message);
    } finally {
      setPlaylistsLoading(false);
    }
  };

  const fetchLatestVideos = async (pageToken) => {
    if (!channel?.channelId || latestLoading) return;
    setLatestError("");
    setLatestLoading(true);
    try {
      const params = { channelId: channel.channelId, count: latestCount };
      if (pageToken) params.pageToken = pageToken;
      const data = await apiGet("channel-latest-videos", params);
      setLatestVideos(data.videos || []);
      setLatestNextToken(data.nextPageToken || null);
      setLatestPrevToken(data.prevPageToken || null);
    } catch (err) {
      setLatestError(err.message);
    } finally {
      setLatestLoading(false);
    }
  };

  const sortedPlaylists = (() => {
    if (!playlists?.length) return [];
    const items = [...playlists];
    const direction = playlistSort.endsWith("-asc") ? 1 : -1;
    switch (playlistSort) {
      case "date-asc":
      case "date-desc":
        return items.sort((a, b) => {
          const aTime = a.publishedAtRaw ? new Date(a.publishedAtRaw).getTime() : 0;
          const bTime = b.publishedAtRaw ? new Date(b.publishedAtRaw).getTime() : 0;
          return (aTime - bTime) * direction;
        });
      case "title-asc":
      case "title-desc":
        return items.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) * direction);
      case "videoCount-asc":
      case "videoCount-desc":
        return items.sort((a, b) => {
          const aCount = a.videoCountRaw ?? 0;
          const bCount = b.videoCountRaw ?? 0;
          return (aCount - bCount) * direction;
        });
      default:
        return items;
    }
  })();

  const filteredPlaylists = (() => {
    if (!sortedPlaylists?.length) return [];
    const term = plTitleSearch.trim().toLowerCase();
    const byTitle = term ? sortedPlaylists.filter((p) => (p.title || "").toLowerCase().includes(term)) : sortedPlaylists;
    if (!plStartDate && !plEndDate) return byTitle;
    return byTitle.filter((p) => {
      if (!p.publishedAtRaw) return false;
      const day = p.publishedAtRaw.slice(0, 10);
      if (plStartDate && day < plStartDate) return false;
      if (plEndDate && day > plEndDate) return false;
      return true;
    });
  })();

  const displayedVideos = useMemo(() => {
    if (!latestVideos) return [];
    return latestVideos.filter(v => {
      const isLive = !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime);
      const isShort = !isLive && v.durationSeconds !== null && v.durationSeconds <= 180;
      const isStandard = !isLive && !isShort;
      return matchesCategoryFilter(categoryFilter, { isStandard, isShort, isLive });
    });
  }, [latestVideos, categoryFilter]);

  const counts = useMemo(() => {
    if (!latestVideos) return { all: 0, standard: 0, shorts: 0, live: 0 };
    const all = latestVideos.length;
    const live = latestVideos.filter(v => !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime)).length;
    const shorts = latestVideos.filter(v => !(v.scheduledStartTime || v.actualStartTime || v.actualEndTime) && v.durationSeconds !== null && v.durationSeconds <= 180).length;
    const standard = all - live - shorts;
    return { all, standard, shorts, live };
  }, [latestVideos]);

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <div className="field">
          <label>Select saved channel</label>
          <select value="" onChange={handleChannelSelect} disabled={!channelsLoaded}>
            <option value="">-- Choose a saved channel --</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
          {!channelsLoaded && <span className="spinner" />}
        </div>
        <div className="field">
          <label>Channel ID, URL, or handle</label>
          <input
            type="text"
            placeholder="e.g. @GoogleDevelopers or UCxxxxxxxxxxxxxxxxxxxxxx"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Fetch Channel
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={reset}>
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {channel && (
        <div style={{ marginTop: 16 }}>
          <ExportBar data={{ ...channel, playlists: sortedPlaylists }} filenameBase="channel-details" />
          {channel.banner !== "N/A" && (
            <ImageWithFallback src={channel.banner} alt="banner" className="banner-img" />
          )}
          {channel.thumbnail !== "N/A" && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <ImageWithFallback src={channel.thumbnail} alt="avatar" className="channel-avatar-square" />
            </div>
          )}
          <div className="channel-card">
            <div>
              <h2 style={{ margin: "0 0 8px" }}>{channel.title}</h2>
              <div className="meta-grid">
                <span><b>Channel ID:</b> {channel.channelId}</span>
                <span><b>Custom URL:</b> {channel.customUrl}</span>
                <span><b>Created:</b> {channel.createdAt}</span>
                <span><b>Country:</b> {channel.country}</span>
                <span><b>Subscribers:</b> {fmtCount(channel.subscriberCount)}</span>
                <span><b>Total Views:</b> {fmtCount(channel.viewCount)}</span>
                <span><b>Video Count:</b> {fmtCount(channel.videoCount)}</span>
              </div>
              {channel.description && (
                <div className="description-wrapper" style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
                    Description:
                  </div>
                  <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
                    <LinkifiedText text={channel.description} />
                  </div>
                </div>
              )}
              {channel.trailerVideo && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Unsubscribed trailer</h3>
                  <VideoCard v={channel.trailerVideo} />
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Public playlists</h3>
                {!playlists && (
                  <>
                    <p style={{ margin: "0 0 10px", fontsize: 14, color: "var(--muted)" }}>
                      Fetch public details from a channel.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      disabled={playlistsLoading}
                      onClick={fetchPlaylists}
                    >
                      {playlistsLoading && <Spinner />}
                      Fetch Playlists
                    </button>
                    {playlistsError && <ErrorBox message={playlistsError} />}
                  </>
                )}
                {playlists?.length === 0 && (
                  <p style={{ margin: 0, fontsize: 14, color: "var(--muted)" }}>No public playlists found for this channel.</p>
                )}
              </div>
              {playlists?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="field" style={{ maxWidth: 260 }}>
                    <label>Sort by</label>
                    <select value={playlistSort} onChange={(e) => setPlaylistSort(e.target.value)}>
                      <option value="date-desc">Published at (newest first)</option>
                      <option value="date-asc">Published at (oldest first)</option>
                      <option value="title-asc">Title (A → Z)</option>
                      <option value="title-desc">Title (Z → A)</option>
                      <option value="videoCount-desc">Video count (highest first)</option>
                      <option value="videoCount-asc">Video count (lowest first)</option>
                    </select>
                  </div>
                  <p className="result-count" style={{ margin: "0 0 8px" }}>
                    Playlist count: {fmtCount(sortedPlaylists.length)}
                  </p>
                  <div className="field">
                    <label>Search playlists by title</label>
                    <input type="text" placeholder="Filter playlists by title" value={plTitleSearch} onChange={(e) => setPlTitleSearch(e.target.value)} />
                  </div>
                  <div className="row">
                    <div className="field">
                      <label>Start date</label>
                      <input type="date" value={plStartDate} onChange={(e) => autoSwapDates(e.target.value, plEndDate, setPlStartDate, setPlEndDate)} />
                    </div>
                    <div className="field">
                      <label>End date</label>
                      <input type="date" value={plEndDate} onChange={(e) => autoSwapDates(plStartDate, e.target.value, setPlStartDate, setPlEndDate)} />
                    </div>
                  </div>
                  <div className="description" style={{ marginTop: 0, maxHeight: "none" }}>
                    <ProgressiveList
                      items={filteredPlaylists}
                      pageSize={50}
                      manual={true}
                      resetKey={`${channel.channelId}:${playlistSort}`}
                      loadingLabel="View more playlists"
                      active={active}
                      renderItem={(playlist) => (
                        <div key={playlist.playlistId} className="video-card">
                          {playlist.thumbnail && (
                            <ImageWithFallback src={playlist.thumbnail} alt={playlist.title} loading="lazy" />
                          )}
                          <div className="body">
                            <p className="title">
                              <a href={playlist.playlistUrl} target="_blank" rel="noreferrer">
                                {playlist.title}
                              </a>
                            </p>
                            <div><b>ID:</b> {playlist.playlistId}</div>
                            <div><b>URL:</b> <a href={playlist.playlistUrl} target="_blank" rel="noreferrer">{playlist.playlistUrl}</a></div>
                            <div><b>Title:</b> {playlist.title}</div>
                            <div><b>Channel ID:</b> {playlist.channelId}</div>
                            <div><b>Published at:</b> {playlist.publishedAt}</div>
                            <div><b>Video count:</b> {fmtCount(playlist.videoCount)}</div>
                          </div>
                        </div>
                      )}
                    />
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Latest Uploads</h3>
                <p style={{ margin: "0 0 10px", fontsize: 14, color: "var(--muted)" }}>
                  Pull latest videos from a channel.
                </p>
                <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
                  <div className="field" style={{ maxWidth: 160 }}>
                    <label>Number of videos (1-50)</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={latestCount}
                      onChange={(e) => {
                        setLatestCount(e.target.value);
                        setLatestVideos(null);
                        setLatestNextToken(null);
                        setLatestPrevToken(null);
                      }}
                    />
                  </div>
                  <div className="row" style={{ gap: 12, marginBottom: 14 }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        latestLoading ||
                        !Number.isInteger(Number(latestCount)) ||
                        Number(latestCount) < 1 ||
                        Number(latestCount) > 50
                      }
                      onClick={() => fetchLatestVideos()}
                    >
                      {latestLoading && <Spinner />}
                      Fetch Latest Videos
                    </button>
                  </div>
                </div>
                <ErrorBox message={latestError} />
                {latestVideos && (
                  <>
                    <ExportBar data={displayedVideos} filenameBase="channel-latest-videos" />

                    {/* Category buttons */}
                    <CategoryFilterButtons categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} counts={counts} />

                    <p className="result-count">
                      {categoryFilter.has("all")
                        ? `Video count: ${fmtCount(latestVideos.length)}`
                        : `Showing ${fmtCount(displayedVideos.length)} of ${fmtCount(latestVideos.length)} videos`}
                    </p>

                    <div>
                      {displayedVideos.map(({ description: _desc, ...v }) => (
                        <VideoCard key={v.videoId} v={v} />
                      ))}
                    </div>
                    {(latestPrevToken || latestNextToken) && (
                      <div className="row" style={{ gap: 12, marginTop: 12 }}>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!latestPrevToken || latestLoading}
                          onClick={() => fetchLatestVideos(latestPrevToken)}
                        >
                          {latestLoading && <Spinner />}
                          Previous Page
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!latestNextToken || latestLoading}
                          onClick={() => fetchLatestVideos(latestNextToken)}
                        >
                          {latestLoading && <Spinner />}
                          Next Page
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared comment rendering ─────────────────────────────────────────────
//
// Used by the Comment Details tab (single comment), Comment Threads
// (top-level threads), and their replies, so all three look and order
// their fields identically: ID, Channel ID, Channel Name (hyperlinked to
// the commenter's channel), Published, Updated (only if different from
// Published), Replies (when applicable), then the comment text.
// In App.jsx - Update CommentCard component
function CommentCard({ comment, children, parentCommentId }) {
  const showUpdated = comment.updatedAt && comment.updatedAt !== comment.publishedAt;

  // Extract parent ID from comment ID (everything before the dot)
  // If the comment ID contains a dot, the part before it is the parent ID
  let extractedParentId = null;
  if (comment.commentId && comment.commentId.includes('.')) {
    extractedParentId = comment.commentId.split('.')[0];
  }

  // Use passed parentCommentId, or comment.parentId, or the extracted one
  const displayParentId = parentCommentId || comment.parentId || extractedParentId;

  return (
    <>
      <div className="comment-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12 }}>
          {comment.authorProfileImageUrl && (
            <ImageWithFallback
              src={comment.authorProfileImageUrl}
              alt={comment.authorName}
              className="comment-avatar"
            />
          )}
          <div className="comment-meta-small">
            <span><b>ID:</b> {comment.commentId}</span>
            {/* Show Parent ID if we have one */}
            {displayParentId && (
              <span><b>Parent ID:</b> {displayParentId}</span>
            )}
            <span><b>Channel ID:</b> {comment.authorChannelId}</span>
            <span>
              <b>Display Name:</b>{" "}
              {comment.authorChannelUrl ? (
                <a href={comment.authorChannelUrl} target="_blank" rel="noreferrer">{comment.authorName}</a>
              ) : (
                comment.authorName
              )}
            </span>
            <span><b>Published:</b> {comment.publishedAt}</span>
            {showUpdated && <span><b>Updated:</b> {comment.updatedAt}</span>}
            {comment.replyCount != null && <span><b>Replies:</b> {comment.replyCount}</span>}
            {comment.likeCount != null && <span><b>Likes:</b> {fmtCount(comment.likeCount)}</span>}
          </div>
        </div>
      </div>
      <div className="description" style={{ marginTop: 10, maxHeight: "none", overflow: "visible" }}>
        <LinkifiedText text={comment.textDisplay} videoId={comment.videoId} />
      </div>
      {children}
    </>
  );
}

// ── Tab: Comment Details ─────────────────────────────────────────────────

function CommentTab() {
  const [input, setInput] = useState("");
  const [comment, setComment] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { items: savedComments, loaded: savedCommentsLoaded } = useSavedItems("saved-comments", "yt-data-saved-comments");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setComment(null);
    setLoading(true);
    try {
      const data = await apiGet("comment", { q: input });
      setComment(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <SavedItemSelect
          items={savedComments}
          loaded={savedCommentsLoaded}
          onSelect={setInput}
          label="Select saved comment"
          placeholder="-- Choose a saved comment --"
        />
        <div className="field">
          <label>Comment ID or URL (with lc= param)</label>
          <input
            type="text"
            placeholder="e.g. https://youtube.com/watch?v=xxx&lc=UgxXXXX"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Fetch Comment
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => {
              setInput("");
              setComment(null);
              setError("");
            }}
          >
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {comment && (
        <div className="comment-thread" style={{ marginTop: 16 }}>
          <ExportBar data={comment} filenameBase="comment-details" />
          <CommentCard comment={comment} parentCommentId={comment.parentId} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Comment Threads ────────────────────────────────────────────────

function CommentsTab({ active = true }) {
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState([]);
  const [commentCount, setCommentCount] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("top");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedThreads, setExpandedThreads] = useState({});
  const [nextPageToken, setNextPageToken] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [replyPages, setReplyPages] = useState({});
  const { items: savedVideos, loaded: savedVideosLoaded } = useSavedItems("videos", "yt-data-saved-videos");
  // manual "View more" style: do not auto-load on scroll for top-level threads

  // Keyword, date range, and sort are all applied live over whatever threads
  // are currently loaded — no refetch needed when they change. The API is
  // always queried in a single consistent order ("top"/relevance) so that
  // pagination stays stable; switching to another sort just re-orders the
  // threads already in memory.
  const displayedThreads = sortThreadsClient(
    filterThreadsClient(threads, keyword, startDate, endDate),
    sort
  );

  const fetchCommentsPage = async ({ pageToken } = {}) => {
    setError("");
    setLoading(true);
    try {
      // Map the sort value to YouTube's API sort parameter
      const apiSort = sort === "top" ? "relevance" : "time";
      const params = {
        q: input,
        sort: sort,  // Pass the user's sort selection
        maxResults: 50
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await apiGet("comments", params);
      setThreads((prev) => [...prev, ...(data.threads || [])]);
      setCommentCount(data.commentCount ?? null);
      setNextPageToken(data.nextPageToken || null);
      setHasMore(Boolean(data.hasMore));
      setExpandedThreads((prev) => (pageToken ? prev : {}));
      setReplyPages((prev) => {
        const next = { ...prev };
        (data.threads || []).forEach((thread) => {
          if (!next[thread.commentId]) {
            next[thread.commentId] = {
              replies: thread.replies || [],
              hasMore: thread.replyCount > (thread.replies?.length || 0),
              nextPageToken: null,
              loading: false,
            };
          }
        });
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setThreads([]);
    setCommentCount(null);
    setNextPageToken(null);
    setHasMore(false);
    setHasSearched(true);
    setExpandedThreads({});
    setReplyPages({});
    await fetchCommentsPage({ pageToken: null });
  };

  const loadMore = async () => {
    if (!nextPageToken || loading) return;
    await fetchCommentsPage({ pageToken: nextPageToken });
  };

  // no automatic loading; user must click "View more" to fetch next page

  const toggleReplies = (threadId) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  };

  const hasFilters = Boolean(keyword.trim() || startDate || endDate);

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <SavedItemSelect
          items={savedVideos}
          loaded={savedVideosLoaded}
          onSelect={setInput}
          label="Select saved video"
          placeholder="-- Choose a saved video --"
        />
        <div className="field">
          <label>Video ID or URL</label>
          <input
            type="text"
            placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Search comment text</label>
          <input
            type="text"
            placeholder="Filter loaded comments by keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="row">
          <div className="field">
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => autoSwapDates(e.target.value, endDate, setStartDate, setEndDate)} />
          </div>
          <div className="field">
            <label>End date</label>
            <input type="date" value={endDate} onChange={(e) => autoSwapDates(startDate, e.target.value, setStartDate, setEndDate)} />
          </div>
        </div>
        <div className="field">
          <label>Sort comments</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="top">Top comments</option>
            <option value="latest">Latest first</option>
            <option value="earliest">Earliest first</option>
            <option value="likes-desc">Likes (highest first)</option>
            <option value="likes-asc">Likes (lowest first)</option>
          </select>
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Fetch Comments
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => {
              setInput("");
              setThreads([]);
              setCommentCount(null);
              setHasSearched(false);
              setError("");
              setSort("top");
              setKeyword("");
              setStartDate("");
              setEndDate("");
              setExpandedThreads({});
              setReplyPages({});
            }}
          >
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {hasSearched && (
        <div style={{ marginTop: 16 }}>
          <p className="result-count">
            Comment count: {commentCount != null ? fmtCount(commentCount) : "N/A"}
            {hasFilters && (
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                {" "}({fmtCount(displayedThreads.length)} shown matching filters)
              </span>
            )}
          </p>
          <ExportBar
            data={displayedThreads.map((thread) => ({
              ...thread,
              replies: (replyPages[thread.commentId]?.replies ?? thread.replies) || [],
            }))}
            filenameBase="comments"
          />
          {displayedThreads.map((thread) => (
            <div key={thread.commentId} className="comment-thread">
              <CommentCard comment={thread}>
                {thread.replyCount > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 10 }}
                    onClick={() => toggleReplies(thread.commentId)}
                  >
                    {expandedThreads[thread.commentId] ? "Hide replies" : `Show replies (${thread.replyCount})`}
                  </button>
                )}
                {expandedThreads[thread.commentId] && (
                  <RepliesList
                    thread={thread}
                    active={active}
                    replyState={replyPages[thread.commentId] || {
                      replies: thread.replies || [],
                      hasMore: thread.replyCount > (thread.replies?.length || 0),
                      nextPageToken: null,
                      loading: false,
                    }}
                    loadMoreReplies={async () => {
                      const pageState = replyPages[thread.commentId] || {
                        replies: thread.replies || [],
                        hasMore: thread.replyCount > (thread.replies?.length || 0),
                        nextPageToken: null,
                        loading: false,
                      };
                      if (!pageState.hasMore || pageState.loading) return;
                      setReplyPages((prev) => ({
                        ...prev,
                        [thread.commentId]: { ...pageState, loading: true },
                      }));
                      try {
                        const params = { parentId: thread.commentId };
                        if (thread.videoId) params.videoId = thread.videoId;
                        if (pageState.nextPageToken) params.pageToken = pageState.nextPageToken;
                        const data = await apiGet("comment-replies", params);
                        setReplyPages((prev) => {
                          const current = prev[thread.commentId] || pageState;
                          const existingIds = new Set(current.replies.map((reply) => reply.commentId));
                          const newReplies = data.replies.filter((reply) => !existingIds.has(reply.commentId));
                          return {
                            ...prev,
                            [thread.commentId]: {
                              replies: [...current.replies, ...newReplies],
                              hasMore: data.hasMore,
                              nextPageToken: data.nextPageToken,
                              loading: false,
                            },
                          };
                        });
                      } catch {
                        setReplyPages((prev) => ({
                          ...prev,
                          [thread.commentId]: { ...pageState, loading: false },
                        }));
                      }
                    }}
                  />
                )}
              </CommentCard>
            </div>
          ))}
          {hasMore && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={loadMore} disabled={loading}>
                {loading ? "Loading..." : "View more comments"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RepliesList({ thread, replyState, loadMoreReplies, active = true }) {
  const { containerRef, isNearBottom } = useInfiniteScroll({ enabled: replyState.hasMore && !replyState.loading && active, threshold: 0.9 });

  useEffect(() => {
    if (isNearBottom && replyState.hasMore && !replyState.loading) {
      loadMoreReplies();
    }
  }, [isNearBottom, replyState.hasMore, replyState.loading, loadMoreReplies]);

  return (
    <div className="replies-list" ref={containerRef}>
      {replyState.replies.map((reply) => (
        <div key={reply.commentId} className="comment-reply">
          <CommentCard comment={reply} parentCommentId={thread.commentId} />
        </div>
      ))}
      {replyState.loading && <div className="message-box secondary" style={{ marginTop: 10 }}>Loading replies...</div>}
      {!replyState.loading && replyState.hasMore && replyState.replies.length > 0 && (
        <div className="message-box secondary" style={{ marginTop: 10 }}>Scroll for more replies</div>
      )}
    </div>
  );
}

// ── Tab: Playlist Videos ─────────────────────────────────────────────────

function PlaylistTab({ active = true }) {
  const [input, setInput] = useState("");
  const [sortOption, setSortOption] = useState("date-asc");
  const [playlistInfo, setPlaylistInfo] = useState(null);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [totalVideoCount, setTotalVideoCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [titleSearch, setTitleSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(() => new Set(["all"]));
  const { items: savedPlaylists, loaded: savedPlaylistsLoaded } = useSavedItems("playlists", "yt-data-saved-playlists");

  const filteredVideos = (() => {
    if (!playlistVideos?.length) return [];
    const term = titleSearch.trim().toLowerCase();
    const byTitle = term ? playlistVideos.filter((v) => (v.title || "").toLowerCase().includes(term)) : playlistVideos;
    return filterVideosByDateRange(byTitle, startDate, endDate);
  })();

  const displayedVideos = useMemo(() => {
    if (!filteredVideos) return [];
    return filteredVideos.filter(v => {
      const isLive = !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime);
      const isShort = !isLive && v.durationSeconds !== null && v.durationSeconds <= 180;
      const isStandard = !isLive && !isShort;
      return matchesCategoryFilter(categoryFilter, { isStandard, isShort, isLive });
    });
  }, [filteredVideos, categoryFilter]);

  const counts = useMemo(() => {
    if (!filteredVideos) return { all: 0, standard: 0, shorts: 0, live: 0 };
    const all = filteredVideos.length;
    const live = filteredVideos.filter(v => !!(v.scheduledStartTime || v.actualStartTime || v.actualEndTime)).length;
    const shorts = filteredVideos.filter(v => !(v.scheduledStartTime || v.actualStartTime || v.actualEndTime) && v.durationSeconds !== null && v.durationSeconds <= 180).length;
    const standard = all - live - shorts;
    return { all, standard, shorts, live };
  }, [filteredVideos]);

  const loadPlaylist = async (sort, pageToken) => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const params = { q: input, sort, maxResults: 50 };
      if (pageToken) params.pageToken = pageToken;
      const result = await apiGet("playlist", params);
      setPlaylistInfo(result.playlistInfo || null);
      setPlaylistVideos((prev) => (pageToken ? [...prev, ...(result.videos || [])] : (result.videos || [])));
      setNextPageToken(result.nextPageToken || null);
      setHasMorePages(Boolean(result.nextPageToken));
      setTotalVideoCount(result.count ?? (result.videos || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setPlaylistInfo(null);
    setPlaylistVideos([]);
    setNextPageToken(null);
    setHasMorePages(false);
    setTotalVideoCount(0);
    setTitleSearch("");
    setStartDate("");
    setEndDate("");
    await loadPlaylist(sortOption);
  };

  // Changing the sort dropdown used to require clicking "Fetch Playlist"
  // again to take effect — this re-fetches immediately instead. It's cheap
  // even for large playlists thanks to server-side caching (see /api/playlist),
  // and resets to the first page since item positions shift with a new sort.
  const handleSortChange = (newSort) => {
    setSortOption(newSort);
    if (playlistInfo) {
      setPlaylistVideos([]);
      setNextPageToken(null);
      setHasMorePages(false);
      loadPlaylist(newSort);
    }
  };

  const reset = () => {
    setInput("");
    setSortOption("date-asc");
    setPlaylistInfo(null);
    setPlaylistVideos([]);
    setError("");
    setTitleSearch("");
    setStartDate("");
    setEndDate("");
    setNextPageToken(null);
    setHasMorePages(false);
    setTotalVideoCount(0);
    setCategoryFilter(new Set(["all"]));
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <SavedItemSelect
          items={savedPlaylists}
          loaded={savedPlaylistsLoaded}
          onSelect={setInput}
          label="Select saved playlist"
          placeholder="-- Choose a saved playlist --"
        />
        <div className="field">
          <label>Playlist ID or URL</label>
          <input
            type="text"
            placeholder="e.g. https://www.youtube.com/playlist?list=PLxxxxxxxx"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Sort by</label>
          <select value={sortOption} onChange={(e) => handleSortChange(e.target.value)}>
            <option value="date-asc">Published at (oldest first)</option>
            <option value="date-desc">Published at (newest first)</option>
            <option value="title-asc">Title (A → Z)</option>
            <option value="title-desc">Title (Z → A)</option>
            <option value="viewCount-desc">View count (highest first)</option>
            <option value="viewCount-asc">View count (lowest first)</option>
            <option value="rating-desc">Rating (highest first)</option>
            <option value="rating-asc">Rating (lowest first)</option>
            <option value="duration-desc">Duration (longest first)</option>
            <option value="duration-asc">Duration (shortest first)</option>
          </select>
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Fetch Playlist
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={reset}>
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {playlistInfo && (
        <>
          <div className="field">
            <label>Search within playlist by title</label>
            <input
              type="text"
              placeholder="Filter loaded videos by title"
              value={titleSearch}
              onChange={(e) => setTitleSearch(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => autoSwapDates(e.target.value, endDate, setStartDate, setEndDate)}
              />
            </div>
            <div className="field">
              <label>End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => autoSwapDates(startDate, e.target.value, setStartDate, setEndDate)}
              />
            </div>
          </div>
          <ExportBar
            data={{ ...(playlistInfo || {}), videos: displayedVideos }}
            filenameBase="playlist-details"
          />
          {/* Category buttons */}
          <CategoryFilterButtons categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} counts={counts} />
          {playlistInfo && Object.keys(playlistInfo).length > 0 && (
            <div className="panel" style={{ marginTop: 16, background: "var(--panel-2)" }}>
              <h3>Playlist Details</h3>
              <div className="video-card" style={{ border: "none", padding: 0 }}>
                {playlistInfo.thumbnail && (
                  <ImageWithFallback
                    src={playlistInfo.thumbnail}
                    alt={playlistInfo.title}
                    loading="lazy"
                  />
                )}
                <div className="body">
                  <p className="title">
                    <a
                      href={`https://www.youtube.com/playlist?list=${playlistInfo.playlistId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {playlistInfo.title}
                    </a>
                  </p>
                  <div className="meta-grid">
                    <span><b>Playlist ID:</b> {playlistInfo.playlistId}</span>
                    <span><b>Channel ID:</b> {playlistInfo.channelId}</span>
                    <span><b>Channel Name:</b> {playlistInfo.channelTitle}</span>
                    <span><b>Published At:</b> {playlistInfo.publishedAt}</span>
                  </div>
                  {playlistInfo.description && (
                    <div className="description-wrapper" style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
                        Description:
                      </div>
                      <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
                        <LinkifiedText text={playlistInfo.description} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <p className="result-count" style={{ marginTop: 16 }}>
            {categoryFilter.has("all")
              ? `Video count: ${fmtCount(totalVideoCount)}`
              : `Showing ${fmtCount(displayedVideos.length)} of ${fmtCount(filteredVideos.length)} videos`
            }
            {(titleSearch || startDate || endDate) && filteredVideos.length !== totalVideoCount && (
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                {" "}({fmtCount(filteredVideos.length)} shown matching filters)
              </span>
            )}
          </p>
          <div>
            {displayedVideos.map(({ description: _desc, ...v }) => (
              <VideoCard key={v.videoId} v={v} />
            ))}
            {hasMorePages && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => loadPlaylist(sortOption, nextPageToken)}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "View more videos"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: Video Player ────────────────────────────────────────────────────

function VideoPlayerTab() {
  const [input, setInput] = useState("");
  const [videoId, setVideoId] = useState(null);
  const [video, setVideo] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { items: savedVideos, loaded: savedVideosLoaded } = useSavedItems("videos", "yt-data-saved-videos");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setVideoId(null);
    setVideo(null);
    const id = parseVideoId(input.trim());
    if (!id) {
      setError("Could not extract a valid video ID from the input.");
      return;
    }
    setVideoId(id);
    setLoading(true);
    try {
      const data = await apiGet("video", { q: input });
      setVideo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <SavedItemSelect
          items={savedVideos}
          loaded={savedVideosLoaded}
          onSelect={setInput}
          label="Select saved video"
          placeholder="-- Choose a saved video --"
        />
        <div className="field">
          <label>Video ID or URL</label>
          <input
            type="text"
            placeholder="e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <button className="primary" disabled={loading || !input.trim()}>
            {loading && <Spinner />}
            Load Video
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => {
              setInput("");
              setVideoId(null);
              setVideo(null);
              setError("");
            }}
          >
            Reset
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {videoId && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingBottom: "56.25%",
              background: "#000",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <iframe
              key={videoId}
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&controls=1&fs=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                border: "none",
              }}
            />
          </div>
          {video?.channelThumbnail && (
            <div style={{ marginTop: 10 }}>
              <ImageWithFallback
                src={video.channelThumbnail}
                alt={video.channelTitle}
                className="comment-avatar"
              />
            </div>
          )}
        </div>
      )}
      {video && (
        <div style={{ marginTop: 16 }}>
          <ExportBar data={video} filenameBase="video-details" />
          <VideoCard v={video} showTags />
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("video");
  const [apiKeySet, setApiKeySet] = useState(true);
  const [scrollPositions, setScrollPositions] = useState({}); // ← NEW

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApiKeySet(!!d.apiKeySet))
      .catch(() => { });
  }, []);

  // ── Restore scroll position on tab change ──
  useEffect(() => {
    const savedPosition = scrollPositions[tab];
    if (savedPosition !== undefined) {
      window.scrollTo({
        top: savedPosition,
        behavior: "auto",
      });
    } else {
      window.scrollTo(0, 0);
    }
  }, [tab, scrollPositions]);

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="dot" />
          <h1>YT Pool</h1>
        </div>
        <nav className="sidebar-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => {
                // ── Save current scroll position ──
                setScrollPositions((prev) => ({
                  ...prev,
                  [tab]: window.scrollY,
                }));
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main className="app-main">
        <div className="app">
          {!apiKeySet && (
            <div className="api-warning">
              No YouTube API key detected. Add <code>YT_API_KEY=your_key</code> to{" "}
              <code>backend/.env</code> and restart the server.
            </div>
          )}

          <div style={{ display: tab === "video" ? "block" : "none" }}><VideoTab /></div>
          <div style={{ display: tab === "player" ? "block" : "none" }}><VideoPlayerTab /></div>
          <div style={{ display: tab === "channelSearch" ? "block" : "none" }}><ChannelSearchTab /></div>
          <div style={{ display: tab === "channel" ? "block" : "none" }}><ChannelTab active={tab === "channel"} /></div>
          <div style={{ display: tab === "comment" ? "block" : "none" }}><CommentTab /></div>
          <div style={{ display: tab === "comments" ? "block" : "none" }}><CommentsTab active={tab === "comments"} /></div>
          <div style={{ display: tab === "playlist" ? "block" : "none" }}><PlaylistTab active={tab === "playlist"} /></div>
          <div style={{ display: tab === "manageChannels" ? "block" : "none" }}><ChannelManagerTab /></div>
          <div style={{ display: tab === "manageVideos" ? "block" : "none" }}><VideoManagerTab /></div>
          <div style={{ display: tab === "managePlaylists" ? "block" : "none" }}><PlaylistManagerTab /></div>
          <div style={{ display: tab === "manageComments" ? "block" : "none" }}><CommentManagerTab /></div>
        </div>
      </main>
    </div>
  );
}