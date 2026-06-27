import React, { useEffect, useState } from "react";
import VideoCard from "./VideoCard.jsx";
import ImageWithFallback from "./ImageWithFallback.jsx";
import { useInfiniteScroll } from "./useInfiniteScroll.jsx";

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
// Used so changing the "Sort by" dropdown re-orders already-fetched results
// instantly, without firing a new network request.

function safeNum(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
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
    default:
      // "relevance" (or anything unrecognized) — keep API-provided order
      return items;
  }
}

// ── Progressive list rendering (infinite scroll over an already-fetched
// array) ─────────────────────────────────────────────────────────────────
// Several endpoints (channel playlists, playlist videos) return the full
// result set in one response. Rather than rendering hundreds of items at
// once, this reveals them in pages as the user scrolls, matching the feel
// of the paginated Comments section even though no extra network calls
// happen after the first one.
const PAGE_SIZE = 20;

function ProgressiveList({ items, pageSize = PAGE_SIZE, resetKey, renderItem, loadingLabel = "Loading more...", active = true }) {
  const [count, setCount] = useState(pageSize);
  const hasMore = count < items.length;
  // No containerRef attached — tracks window scroll, same as the top-level
  // comment thread list (RepliesList instead tracks its own scrollable box).
  // `active` is false while the parent tab is hidden (display:none), so a
  // background tab's scroll listener doesn't fire off another tab's scrolling.
  const { isNearBottom } = useInfiniteScroll({ enabled: hasMore && active, threshold: 0.85 });

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  useEffect(() => {
    if (isNearBottom && hasMore) {
      setCount((c) => Math.min(c + pageSize, items.length));
    }
  }, [isNearBottom, hasMore, pageSize, items.length]);

  return (
    <div>
      {items.slice(0, count).map(renderItem)}
      {hasMore && (
        <div className="message-box secondary" style={{ marginTop: 10 }}>{loadingLabel}</div>
      )}
    </div>
  );
}

const TABS = [
  { id: "video", label: "Video Details" },
  { id: "player", label: "Video Player" },
  { id: "channelSearch", label: "Search" },
  { id: "manageChannels", label: "Manage Channels" },
  { id: "channel", label: "Channel Details" },
  { id: "comment", label: "Comment Details" },
  { id: "comments", label: "Comments Section" },
  { id: "playlist", label: "Playlist Details" },
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
  // XML element names can't start with a digit or contain spaces; sanitize.
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
      <span style={{ fontSize: 13, opacity: 0.65, alignSelf: "center" }}>Export results:</span>
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

// ── Tab: Single Video Details ────────────────────────────────────────────

function VideoTab() {
  const [input, setInput] = useState("");
  const [video, setVideo] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <VideoCard v={video} />
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
          <span><b>Subscribers:</b> {ch.subscribers}</span>
          <span><b>Videos:</b> {ch.videoCount}</span>
          <span><b>Total views:</b> {ch.viewCount}</span>
          <span><b>Country:</b> {ch.country}</span>
          <span><b>Created:</b> {ch.publishedAt}</span>
        </div>
        {ch.description && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
            {ch.description}
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
          <span><b>Videos:</b> {pl.videoCount}</span>
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
  const [useCustomChannel, setUseCustomChannel] = useState(false);
  const [customChannelId, setCustomChannelId] = useState("");
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState("");
  const [mode, setMode] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [usePerFieldKeywords, setUsePerFieldKeywords] = useState(false);
  const [keywordTitle, setKeywordTitle] = useState("");
  const [keywordDescription, setKeywordDescription] = useState("");
  const [keywordChannel, setKeywordChannel] = useState("");
  const [sortOption, setSortOption] = useState("relevance");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useDateRange, setUseDateRange] = useState(false);
  const [useDuration, setUseDuration] = useState(false);
  const [durationFilter, setDurationFilter] = useState("medium");

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

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Videos are fetched once with full data (date, views, likes, title all
  // present in every record), so changing the "Sort by" dropdown re-orders
  // the already-fetched results client-side instead of firing a new request.
  const sortedVideos = videos ? sortVideosClient(videos, sortOption) : null;

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

  const clearResults = () => {
    setVideos(null);
    setChannelResults(null);
    setPlaylistResults(null);
    setError("");
  };

  const resetAll = () => {
    clearResults();
    setSearchType("channel");
    setUseCustomChannel(false);
    setCustomChannelId("");
    setMode("keyword");
    setKeyword("");
    setUsePerFieldKeywords(false);
    setKeywordTitle("");
    setKeywordDescription("");
    setKeywordChannel("");
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
          const params = { channelId: resolvedChannelId, mode };
          if (mode === "keyword") {
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
          } else {
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
          if (!usePerFieldKeywords && !keyword.trim()) throw new Error("Keyword is required for general video search");
          if (usePerFieldKeywords && !hasPerField) throw new Error("At least one per-field keyword is required");
          const params = { sort: sortOption, maxResults };
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

  const isChannelSearch = searchType === "channel";

  // Derive submit disabled state
  const isDisabled = (() => {
    const maxNum = Number(maxResults);
    if (!maxResults || maxNum < 50 || maxNum > 500) return true;
    if (loading) return true;
    if (category === "video") {
      if (isChannelSearch && !useCustomChannel && !channelId) return true;
      if (isChannelSearch && useCustomChannel && !customChannelId.trim()) return true;
      if (isChannelSearch && mode === "keyword") {
        if (usePerFieldKeywords && !keywordTitle.trim() && !keywordDescription.trim() && !keywordChannel.trim()) return true;
        if (!usePerFieldKeywords && !keyword.trim()) return true;
      }
      if (!isChannelSearch) {
        if (usePerFieldKeywords && !keywordTitle.trim() && !keywordDescription.trim() && !keywordChannel.trim()) return true;
        if (!usePerFieldKeywords && !keyword.trim()) return true;
      }
    } else if (category === "channel") {
      if (!chKeyword.trim()) return true;
    } else {
      if (plUsePerField && !plKeywordTitle.trim() && !plKeywordChannel.trim()) return true;
      if (!plUsePerField && !plKeyword.trim()) return true;
    }
    return false;
  })();

  const autoSwapDates = (newStart, newEnd, setStart, setEnd) => {
    if (newStart && newEnd && newEnd < newStart) {
      setStart(newEnd);
      setEnd(newStart);
    } else {
      setStart(newStart);
      setEnd(newEnd);
    }
  };

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
                <option value="channel">Search within Channel</option>
                <option value="general">Search Videos Generally</option>
              </select>
            </div>

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
                  <p style={{ margin: 0, opacity: 0.6, fontSize: 13 }}>
                    No saved channels. Add some in the <b>Manage Channels</b> tab, or check the box above to enter an ID manually.
                  </p>
                )}
              </div>
            )}

            {isChannelSearch && (
              <div className="field">
                <label>Search mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="keyword">Keyword</option>
                  <option value="date">Date range</option>
                </select>
              </div>
            )}

            {isChannelSearch && mode === "keyword" && (
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
                  </select>
                </div>
              </>
            )}

            {!isChannelSearch && (
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
                  </select>
                </div>
              </>
            )}

            {isChannelSearch && mode === "keyword" && (
              <label className="checkbox-row">
                <input type="checkbox" checked={useDateRange} onChange={(e) => setUseDateRange(e.target.checked)} />
                Filter by date range
              </label>
            )}

            {isChannelSearch && mode === "date" && (
              <div className="field">
                <label>Sort by</label>
                <select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
                  <option value="date-desc">Date (newest first)</option>
                  <option value="date-asc">Date (oldest first)</option>
                </select>
              </div>
            )}

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
          <p className="result-count">Result count: {videos.length}</p>
          <ExportBar data={sortedVideos} filenameBase="video-search-results" />
          {sortedVideos.map(({ description: _desc, ...v }) => (
            <VideoCard key={v.videoId} v={v} />
          ))}
        </>
      )}

      {channelResults && (
        <>
          <p className="result-count">Result count: {channelResults.length}</p>
          <ExportBar data={channelResults} filenameBase="channel-search-results" />
          {channelResults.map((ch) => (
            <ChannelResultCard key={ch.channelId} ch={ch} />
          ))}
        </>
      )}

      {playlistResults && (
        <>
          <p className="result-count">Result count: {playlistResults.length}</p>
          <ExportBar data={playlistResults} filenameBase="playlist-search-results" />
          {playlistResults.map((pl) => (
            <PlaylistResultCard key={pl.playlistId} pl={pl} />
          ))}
        </>
      )}
    </div>
  );
}

function ChannelManagerTab() {
  const [channels, setChannels] = useState([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");
  const [loading, setLoading] = useState(false);

  const refreshChannels = async () => {
    try {
      const data = await apiGet("channels");
      setChannels(data);
      setChannelsLoaded(true);
      if (data.length && !data.some((c) => c.id === selectedId)) {
        setSelectedId("");
        setName("");
        setId("");
      }
    } catch {
      setChannelsLoaded(false);
    }
  };

  useEffect(() => {
    refreshChannels();
  }, []);

  const selectChannel = (channelId) => {
    const channel = channels.find((c) => c.id === channelId);
    if (channel) {
      setSelectedId(channel.id);
      setName(channel.name);
      setId(channel.id);
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

  const createChannel = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), id: id.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add channel");
      await refreshChannels();
      setSelectedId(data.id);
      setName(data.name);
      setId(data.id);
      notify("Channel added successfully.", "success");
    } catch (err) {
      notify(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateChannel = async () => {
    if (!selectedId) {
      return notify("Select a channel to update.");
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), id: id.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't update channel");
      await refreshChannels();
      setSelectedId(data.id);
      setName(data.name);
      setId(data.id);
      notify("Channel updated successfully.", "success");
    } catch (err) {
      notify(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteChannel = async () => {
    if (!selectedId) {
      return notify("Select a channel to delete.");
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't delete channel");
      await refreshChannels();
      setSelectedId("");
      setName("");
      setId("");
      notify("Channel deleted successfully.", "success");
    } catch (err) {
      notify(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h2>Manage Channels</h2>
      {channelsLoaded && channels.length > 0 && (
        <ExportBar data={channels} filenameBase="saved-channels" />
      )}
      <div className="field">
        <label>Saved channels</label>
        <select value={selectedId} onChange={(e) => selectChannel(e.target.value)}>
          <option value="">-- Select saved channel --</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Channel name</label>
        <input
          type="text"
          placeholder="Name to display in dropdown"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Channel ID</label>
        <input
          type="text"
          placeholder="Channel ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="secondary"
          onClick={createChannel}
          disabled={loading || !name.trim() || !id.trim()}
        >
          Add
        </button>
        <button
          type="button"
          className="secondary"
          onClick={updateChannel}
          disabled={loading || !selectedId || !name.trim() || !id.trim()}
        >
          Update
        </button>
        <button
          type="button"
          className="secondary"
          onClick={deleteChannel}
          disabled={loading || !selectedId}
        >
          Delete
        </button>
      </div>
      {message && <ErrorBox message={message} type={messageType} />}
    </div>
  );
}

// ── Tab: Channel Details ─────────────────────────────────────────────────

function ChannelTab({ active = true }) {
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playlistSort, setPlaylistSort] = useState("date-desc");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setChannel(null);
    setLoading(true);
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
  };

  const sortedPlaylists = (() => {
    if (!channel?.playlists?.length) return [];
    const items = [...channel.playlists];
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

  return (
    <div className="panel">
      <form onSubmit={submit}>
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
            <div className="channel-avatar-row">
              <ImageWithFallback src={channel.thumbnail} alt="avatar" className="channel-avatar-large" />
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
                <span><b>Subscribers:</b> {channel.subscriberCount}</span>
                <span><b>Total Views:</b> {channel.viewCount}</span>
                <span><b>Video Count:</b> {channel.videoCount}</span>
              </div>
              {channel.description && (
                <div className="description" style={{ marginTop: 10, maxHeight: "none", overflow: "visible" }}>
                  {channel.description}
                </div>
              )}
              {channel.playlists?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Public playlists</h3>
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
                    Playlist count: {sortedPlaylists.length}
                  </p>
                  <div className="description" style={{ marginTop: 0, maxHeight: "none" }}>
                    <ProgressiveList
                      items={sortedPlaylists}
                      resetKey={`${channel.channelId}:${playlistSort}`}
                      loadingLabel="Scroll for more playlists"
                      active={active}
                      renderItem={(playlist) => (
                        <div key={playlist.playlistId} style={{ marginBottom: 10 }}>
                          <div><b>ID:</b> {playlist.playlistId}</div>
                          <div><b>URL:</b> <a href={playlist.playlistUrl} target="_blank" rel="noreferrer">{playlist.playlistUrl}</a></div>
                          <div><b>Title:</b> {playlist.title}</div>
                          <div><b>Channel ID:</b> {playlist.channelId}</div>
                          <div><b>Published at:</b> {playlist.publishedAt}</div>
                          <div><b>Video count:</b> {playlist.videoCount}</div>
                        </div>
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Comment Details ─────────────────────────────────────────────────

function CommentTab() {
  const [input, setInput] = useState("");
  const [comment, setComment] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        <div className="panel" style={{ marginTop: 16, background: "var(--panel-2)" }}>
          <ExportBar data={comment} filenameBase="comment-details" />
          <div className="meta-grid">
            <span><b>Comment ID:</b> {comment.commentId}</span>
            <span><b>Author:</b> {comment.authorName}</span>
            <span><b>Author Channel ID:</b> {comment.authorChannelId}</span>
            <span><b>Likes:</b> {comment.likeCount}</span>
            <span><b>Published:</b> {comment.publishedAt}</span>
            <span><b>Updated:</b> {comment.updatedAt}</span>
          </div>
          <div className="comment-author-row" style={{ marginTop: 12 }}>
            {comment.authorProfileImageUrl && (
              <ImageWithFallback
                src={comment.authorProfileImageUrl}
                alt={comment.authorName}
                className="comment-avatar"
              />
            )}
            <div className="description" style={{ marginTop: 0, maxHeight: "none" }}>
              {comment.textDisplay}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Playlist Videos ─────────────────────────────────────────────────

function CommentsTab({ active = true }) {
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState([]);
  const [commentCount, setCommentCount] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("top");
  const [mode, setMode] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedThreads, setExpandedThreads] = useState({});
  const [nextPageToken, setNextPageToken] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [replyPages, setReplyPages] = useState({});
  // `active` is false while this tab is hidden (display:none) — without
  // this gate, scrolling on a different tab could trigger comment-page
  // fetches in the background and silently burn API quota.
  const { isNearBottom } = useInfiniteScroll({ enabled: hasMore && active });

  const buildBaseParams = () => {
    const params = { q: input, sort };
    if (mode === "keyword" && keyword.trim()) {
      params.keyword = keyword.trim();
    }
    if (mode === "date") {
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
    }
    return params;
  };

  const fetchCommentsPage = async ({ pageToken } = {}) => {
    setError("");
    setLoading(true);
    try {
      const params = buildBaseParams();
      if (pageToken) params.pageToken = pageToken;
      const data = await apiGet("comments", params);
      setThreads((prev) => [...prev, ...(data.threads || [])]);
      // commentCount comes straight from the video's statistics on every page response
      // (it's the same stable number each time, not an accumulation of loaded items).
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
    await fetchCommentsPage();
  };

  const loadMore = async () => {
    if (!nextPageToken || loading) return;
    await fetchCommentsPage({ pageToken: nextPageToken });
  };

  useEffect(() => {
    if (isNearBottom && hasMore && !loading) {
      loadMore();
    }
  }, [isNearBottom, hasMore, loading, nextPageToken]);

  const toggleReplies = (threadId) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
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
          <label>Search mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="keyword">Keyword</option>
            <option value="date">Date range</option>
          </select>
        </div>
        {mode === "keyword" && (
          <div className="field">
            <label>Keyword</label>
            <input
              type="text"
              placeholder="Search comment text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        )}
        {mode === "date" && (
          <div className="row">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        )}
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
              setMode("keyword");
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
            Comment count: {commentCount != null ? commentCount : "N/A"}
          </p>
          <ExportBar
            data={threads.map((thread) => ({
              ...thread,
              replies: (replyPages[thread.commentId]?.replies ?? thread.replies) || [],
            }))}
            filenameBase="comments"
          />
          {threads.map((thread) => (
            <div key={thread.commentId} className="comment-thread">
              <div className="comment-header">
                {thread.authorProfileImageUrl && (
                  <ImageWithFallback
                    src={thread.authorProfileImageUrl}
                    alt={thread.authorName}
                    className="comment-avatar"
                  />
                )}
                <div>
                  <div className="comment-meta">
                    <span><b>{thread.authorName}</b></span>
                    {thread.authorChannelUrl && (
                      <span>
                        <a href={thread.authorChannelUrl} target="_blank" rel="noreferrer">
                          View channel
                        </a>
                      </span>
                    )}
                    <span>({thread.authorChannelId})</span>
                  </div>
                  <div className="comment-meta-small">
                    <span>ID: {thread.commentId}</span>
                    <span>Likes: {thread.likeCount}</span>
                    <span>Published: {thread.publishedAt}</span>
                    <span>Updated: {thread.updatedAt}</span>
                    <span>Replies: {thread.replyCount}</span>
                  </div>
                </div>
              </div>
              <div className="description" style={{ marginTop: 10, maxHeight: "none", overflow: "visible" }}>{thread.textDisplay}</div>
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
                      [thread.commentId]: {
                        ...pageState,
                        loading: true,
                      },
                    }));
                    try {
                      const params = { parentId: thread.commentId };
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
                    } catch (err) {
                      setReplyPages((prev) => ({
                        ...prev,
                        [thread.commentId]: {
                          ...pageState,
                          loading: false,
                        },
                      }));
                    }
                  }}
                />
              )}
            </div>
          ))}
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
          <div className="comment-header">
            {reply.authorProfileImageUrl && (
              <ImageWithFallback
                src={reply.authorProfileImageUrl}
                alt={reply.authorName}
                className="comment-avatar"
              />
            )}
            <div>
              <div className="comment-meta">
                <span><b>{reply.authorName}</b></span>
                {reply.authorChannelUrl && (
                  <span>
                    <a href={reply.authorChannelUrl} target="_blank" rel="noreferrer">
                      View channel
                    </a>
                  </span>
                )}
                <span>({reply.authorChannelId})</span>
              </div>
              <div className="comment-meta-small">
                <span>ID: {reply.commentId}</span>
                <span>Likes: {reply.likeCount}</span>
                <span>Published: {reply.publishedAt}</span>
                <span>Updated: {reply.updatedAt}</span>
              </div>
            </div>
          </div>
          <div className="description" style={{ marginTop: 10, maxHeight: "none", overflow: "visible" }}>{reply.textDisplay}</div>
        </div>
      ))}
      {replyState.loading && <div className="message-box secondary" style={{ marginTop: 10 }}>Loading replies...</div>}
      {!replyState.loading && replyState.hasMore && replyState.replies.length > 0 && (
        <div className="message-box secondary" style={{ marginTop: 10 }}>Scroll for more replies</div>
      )}
    </div>
  );
}

function PlaylistTab({ active = true }) {
  const [input, setInput] = useState("");
  const [sortOption, setSortOption] = useState("date-asc");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // The playlist endpoint returns every video with full details up front,
  // so re-sorting on dropdown change is done client-side without refetching.
  const sortedVideos = data?.videos ? sortVideosClient(data.videos, sortOption) : [];

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setData(null);
    setLoading(true);
    try {
      const result = await apiGet("playlist", { q: input, sort: sortOption });
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setInput("");
    setSortOption("date-asc");
    setData(null);
    setError("");
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
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
          <select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
            <option value="date-asc">Published at (oldest first)</option>
            <option value="date-desc">Published at (newest first)</option>
            <option value="title-asc">Title (A → Z)</option>
            <option value="title-desc">Title (Z → A)</option>
            <option value="viewCount-desc">View count (highest first)</option>
            <option value="viewCount-asc">View count (lowest first)</option>
            <option value="rating-desc">Rating (highest first)</option>
            <option value="rating-asc">Rating (lowest first)</option>
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
      {data && (
        <>
          <ExportBar
            data={{ ...(data.playlistInfo || {}), videos: sortedVideos }}
            filenameBase="playlist-details"
          />
          {data.playlistInfo && Object.keys(data.playlistInfo).length > 0 && (
            <div className="panel" style={{ marginTop: 16, background: "var(--panel-2)" }}>
              <h3>Playlist Details</h3>
              <div className="meta-grid">
                <span><b>Playlist ID:</b> {data.playlistInfo.playlistId}</span>
                <span><b>Title:</b> {data.playlistInfo.title}</span>
                <span><b>Channel ID:</b> {data.playlistInfo.channelId}</span>
                <span><b>Channel Name:</b> {data.playlistInfo.channelTitle}</span>
                <span><b>Published At:</b> {data.playlistInfo.publishedAt}</span>
              </div>
            </div>
          )}
          <p className="result-count" style={{ marginTop: 16 }}>Video count: {sortedVideos.length}</p>
          <ProgressiveList
            items={sortedVideos}
            resetKey={`${data.playlistInfo?.playlistId || ""}:${sortOption}`}
            renderItem={({ description: _desc, ...v }) => <VideoCard key={v.videoId} v={v} />}
            loadingLabel="Scroll for more videos"
            active={active}
          />
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
          <VideoCard v={video} />
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("video");
  const [apiKeySet, setApiKeySet] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApiKeySet(!!d.apiKeySet))
      .catch(() => { });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="dot" />
        <h1>YouTube Data Extraction Tool</h1>
      </header>

      {!apiKeySet && (
        <div className="api-warning">
          No YouTube API key detected. Add <code>YT_API_KEY=your_key</code> to{" "}
          <code>backend/.env</code> and restart the server.
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* All tabs stay mounted and are hidden with CSS rather than being
          conditionally rendered, so switching tabs and coming back no
          longer loses fetched results, scroll position, or filter inputs.
          Tabs with scroll-triggered fetches receive `active` so they don't
          keep listening (and fetching) while hidden in the background. */}
      <div style={{ display: tab === "video" ? "block" : "none" }}><VideoTab /></div>
      <div style={{ display: tab === "player" ? "block" : "none" }}><VideoPlayerTab /></div>
      <div style={{ display: tab === "channelSearch" ? "block" : "none" }}><ChannelSearchTab /></div>
      <div style={{ display: tab === "manageChannels" ? "block" : "none" }}><ChannelManagerTab /></div>
      <div style={{ display: tab === "channel" ? "block" : "none" }}><ChannelTab active={tab === "channel"} /></div>
      <div style={{ display: tab === "comment" ? "block" : "none" }}><CommentTab /></div>
      <div style={{ display: tab === "comments" ? "block" : "none" }}><CommentsTab active={tab === "comments"} /></div>
      <div style={{ display: tab === "playlist" ? "block" : "none" }}><PlaylistTab active={tab === "playlist"} /></div>
    </div>
  );
}