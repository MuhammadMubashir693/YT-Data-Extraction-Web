import React, { useEffect, useState } from "react";
import VideoCard from "./VideoCard.jsx";

const TABS = [
  { id: "video", label: "Video Details" },
  { id: "channelSearch", label: "Search Channel Videos" },
  { id: "channel", label: "Channel Details" },
  { id: "comment", label: "Comment Details" },
  { id: "playlist", label: "Playlist Videos" },
];

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/${path}${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function ErrorBox({ message }) {
  if (!message) return null;
  return <div className="error-box">{message}</div>;
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
        <button className="primary" disabled={loading || !input.trim()}>
          {loading && <Spinner />}
          Fetch Video
        </button>
      </form>
      <ErrorBox message={error} />
      {video && (
        <div style={{ marginTop: 16 }}>
          <VideoCard v={video} />
        </div>
      )}
    </div>
  );
}

// ── Tab: Search Channel Videos ───────────────────────────────────────────

function ChannelSearchTab() {
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState("");
  const [mode, setMode] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useDateRange, setUseDateRange] = useState(false);
  const [useDuration, setUseDuration] = useState(false);
  const [durationFilter, setDurationFilter] = useState("medium");
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [manageName, setManageName] = useState("");
  const [manageId, setManageId] = useState("");
  const [manageSelectedId, setManageSelectedId] = useState("");
  const [manageMessage, setManageMessage] = useState("");
  const [manageLoading, setManageLoading] = useState(false);

  const refreshChannels = async () => {
    try {
      const data = await apiGet("channels");
      setChannels(data);
      if (data.length) {
        if (!data.some((c) => c.id === channelId)) {
          setChannelId(data[0].id);
        }
        if (!manageSelectedId || !data.some((c) => c.id === manageSelectedId)) {
          setManageSelectedId(data[0].id);
          setManageName(data[0].name);
          setManageId(data[0].id);
        }
      } else {
        setManageSelectedId("");
        setManageName("");
        setManageId("");
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshChannels();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setVideos(null);
    setLoading(true);
    try {
      const params = { channelId, mode };
      if (mode === "keyword") {
        params.keyword = keyword;
        if (useDateRange) {
          params.startDate = startDate;
          params.endDate = endDate;
        }
      } else {
        params.startDate = startDate;
        params.endDate = endDate;
      }
      if (useDuration) params.durationFilter = durationFilter;

      const data = await apiGet("channel-videos", params);
      setVideos(data.videos);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectManageChannel = (id) => {
    const channel = channels.find((c) => c.id === id);
    if (channel) {
      setManageSelectedId(id);
      setManageName(channel.name);
      setManageId(channel.id);
    }
  };

  const handleManageError = (message) => {
    setManageMessage(message);
    setTimeout(() => setManageMessage(""), 4000);
  };

  const createChannel = async () => {
    setManageLoading(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: manageName.trim(), id: manageId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add channel");
      await refreshChannels();
      setManageSelectedId(data.id);
      setChannelId(data.id);
      handleManageError("Channel added successfully.");
    } catch (err) {
      handleManageError(err.message);
    } finally {
      setManageLoading(false);
    }
  };

  const updateChannel = async () => {
    if (!manageSelectedId) {
      return handleManageError("Select a channel to update.");
    }
    setManageLoading(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(manageSelectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: manageName.trim(), id: manageId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't update channel");
      await refreshChannels();
      setManageSelectedId(data.id);
      setChannelId(data.id);
      handleManageError("Channel updated successfully.");
    } catch (err) {
      handleManageError(err.message);
    } finally {
      setManageLoading(false);
    }
  };

  const deleteChannel = async () => {
    if (!manageSelectedId) {
      return handleManageError("Select a channel to delete.");
    }
    setManageLoading(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(manageSelectedId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't delete channel");
      await refreshChannels();
      if (channelId === manageSelectedId) {
        setChannelId("");
      }
      handleManageError("Channel deleted successfully.");
    } catch (err) {
      handleManageError(err.message);
    } finally {
      setManageLoading(false);
    }
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <div className="field">
          <label>Channel</label>
          {channels.length ? (
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Channel ID (enter manually or add in the manager below)"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            />
          )}
        </div>

        <div className="panel" style={{ marginBottom: 20, background: "var(--panel-2)" }}>
          <h3>Manage saved channels</h3>
          <div className="field">
            <label>Saved channels</label>
            <select
              value={manageSelectedId}
              onChange={(e) => selectManageChannel(e.target.value)}
            >
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
              value={manageName}
              onChange={(e) => setManageName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Channel ID</label>
            <input
              type="text"
              placeholder="Channel ID"
              value={manageId}
              onChange={(e) => setManageId(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={createChannel}
              disabled={manageLoading || !manageName.trim() || !manageId.trim()}
            >
              Add
            </button>
            <button
              type="button"
              className="secondary"
              onClick={updateChannel}
              disabled={manageLoading || !manageSelectedId || !manageName.trim() || !manageId.trim()}
            >
              Update
            </button>
            <button
              type="button"
              className="secondary"
              onClick={deleteChannel}
              disabled={manageLoading || !manageSelectedId}
            >
              Delete
            </button>
          </div>
          {manageMessage && <ErrorBox message={manageMessage} />}
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
              placeholder="e.g. tutorial"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        )}

        {mode === "keyword" && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={useDateRange}
              onChange={(e) => setUseDateRange(e.target.checked)}
            />
            Also filter by date range
          </label>
        )}

        {(mode === "date" || (mode === "keyword" && useDateRange)) && (
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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useDuration}
            onChange={(e) => setUseDuration(e.target.checked)}
          />
          Filter by duration type
        </label>

        {useDuration && (
          <div className="field">
            <label>Duration</label>
            <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value)}>
              <option value="short">Short (&lt; 4 min)</option>
              <option value="medium">Medium (4-20 min)</option>
              <option value="long">Long (&gt; 20 min)</option>
            </select>
          </div>
        )}

        <button className="primary" disabled={loading || !channelId}>
          {loading && <Spinner />}
          Search
        </button>
      </form>

      <ErrorBox message={error} />

      {videos && (
        <>
          <p className="result-count">Result count: {videos.length}</p>
          {videos.map((v) => (
            <VideoCard key={v.videoId} v={v} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Tab: Channel Details ─────────────────────────────────────────────────

function ChannelTab() {
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setChannel(null);
    setLoading(true);
    try {
      const data = await apiGet("channel", { q: input });
      setChannel(data);
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
          <label>Channel ID, URL, or handle</label>
          <input
            type="text"
            placeholder="e.g. @GoogleDevelopers or UCxxxxxxxxxxxxxxxxxxxxxx"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button className="primary" disabled={loading || !input.trim()}>
          {loading && <Spinner />}
          Fetch Channel
        </button>
      </form>
      <ErrorBox message={error} />
      {channel && (
        <div style={{ marginTop: 16 }}>
          {channel.banner !== "N/A" && (
            <img src={channel.banner} alt="banner" className="banner-img" />
          )}
          <div className="channel-card">
            {channel.thumbnail !== "N/A" && (
              <img src={channel.thumbnail} alt="avatar" className="avatar" />
            )}
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
                <div className="description" style={{ marginTop: 10 }}>
                  {channel.description}
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
        <button className="primary" disabled={loading || !input.trim()}>
          {loading && <Spinner />}
          Fetch Comment
        </button>
      </form>
      <ErrorBox message={error} />
      {comment && (
        <div className="panel" style={{ marginTop: 16, background: "var(--panel-2)" }}>
          <div className="meta-grid">
            <span><b>Comment ID:</b> {comment.commentId}</span>
            <span><b>Author:</b> {comment.authorName}</span>
            <span><b>Author Channel ID:</b> {comment.authorChannelId}</span>
            <span><b>Likes:</b> {comment.likeCount}</span>
            <span><b>Published:</b> {comment.publishedAt}</span>
            <span><b>Updated:</b> {comment.updatedAt}</span>
          </div>
          <div className="description" style={{ marginTop: 10, maxHeight: "none" }}>
            {comment.textDisplay}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Playlist Videos ─────────────────────────────────────────────────

function PlaylistTab() {
  const [input, setInput] = useState("");
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setVideos(null);
    setLoading(true);
    try {
      const data = await apiGet("playlist", { q: input });
      setVideos(data.videos);
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
          <label>Playlist ID or URL</label>
          <input
            type="text"
            placeholder="e.g. https://www.youtube.com/playlist?list=PLxxxxxxxx"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button className="primary" disabled={loading || !input.trim()}>
          {loading && <Spinner />}
          Fetch Playlist
        </button>
      </form>
      <ErrorBox message={error} />
      {videos && (
        <>
          <p className="result-count">Result count: {videos.length}</p>
          {videos.map((v) => (
            <VideoCard key={v.videoId} v={v} />
          ))}
        </>
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
      .catch(() => {});
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

      {tab === "video" && <VideoTab />}
      {tab === "channelSearch" && <ChannelSearchTab />}
      {tab === "channel" && <ChannelTab />}
      {tab === "comment" && <CommentTab />}
      {tab === "playlist" && <PlaylistTab />}
    </div>
  );
}
