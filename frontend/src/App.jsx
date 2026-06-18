import React, { useEffect, useState } from "react";
import VideoCard from "./VideoCard.jsx";
import ImageWithFallback from "./ImageWithFallback.jsx";
import { useInfiniteScroll } from "./useInfiniteScroll.jsx";

const TABS = [
  { id: "video", label: "Video Details" },
  { id: "channelSearch", label: "Search Videos" },
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

// ── Tab: Search Videos ──────────────────────────────────────────────

function ChannelSearchTab() {
  const [searchType, setSearchType] = useState("channel"); // 'channel' | 'general'
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
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setVideos(null);
    setLoading(true);
    try {
      if (searchType === "channel") {
        const params = { channelId, mode };
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

        const data = await apiGet("channel-videos", params);
        setVideos(data.videos);
      } else {
        // General search
        const hasPerField = usePerFieldKeywords && (keywordTitle.trim() || keywordDescription.trim() || keywordChannel.trim());
        if (!usePerFieldKeywords && !keyword.trim()) {
          throw new Error("Keyword is required for general video search");
        }
        if (usePerFieldKeywords && !hasPerField) {
          throw new Error("At least one per-field keyword is required");
        }
        const params = { sort: sortOption };
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isChannelSearch = searchType === "channel";

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <div className="field">
          <label>Search Type</label>
          <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>
            <option value="channel">Search within Channel</option>
            <option value="general">Search Videos Generally</option>
          </select>
        </div>

        {isChannelSearch && (
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
                placeholder="Channel ID (enter manually or add in Manage Channels tab)"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              />
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
              <input
                type="checkbox"
                checked={usePerFieldKeywords}
                onChange={(e) => setUsePerFieldKeywords(e.target.checked)}
              />
              Specify separate keywords per field
            </label>
            {usePerFieldKeywords ? (
              <>
                <div className="field">
                  <label>Title keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordTitle}
                    onChange={(e) => setKeywordTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Description keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordDescription}
                    onChange={(e) => setKeywordDescription(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Channel name keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordChannel}
                    onChange={(e) => setKeywordChannel(e.target.value)}
                  />
                </div>
              </>
            ) : (
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
              <input
                type="checkbox"
                checked={usePerFieldKeywords}
                onChange={(e) => setUsePerFieldKeywords(e.target.checked)}
              />
              Specify separate keywords per field
            </label>
            {usePerFieldKeywords ? (
              <>
                <div className="field">
                  <label>Title keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordTitle}
                    onChange={(e) => setKeywordTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Description keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordDescription}
                    onChange={(e) => setKeywordDescription(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Channel name keyword</label>
                  <input
                    type="text"
                    placeholder="Leave empty to ignore"
                    value={keywordChannel}
                    onChange={(e) => setKeywordChannel(e.target.value)}
                  />
                </div>
              </>
            ) : (
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
            <input
              type="checkbox"
              checked={useDateRange}
              onChange={(e) => setUseDateRange(e.target.checked)}
            />
            Also filter by date range
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

        {((!isChannelSearch) || (isChannelSearch && mode === "date") || (isChannelSearch && mode === "keyword" && useDateRange)) && (
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

        <button className="primary" disabled={
          loading ||
          (isChannelSearch && !channelId) ||
          (!isChannelSearch && !usePerFieldKeywords && !keyword.trim()) ||
          (!isChannelSearch && usePerFieldKeywords && !keywordTitle.trim() && !keywordDescription.trim() && !keywordChannel.trim()) ||
          (isChannelSearch && mode === "keyword" && usePerFieldKeywords && !keywordTitle.trim() && !keywordDescription.trim() && !keywordChannel.trim()) ||
          (isChannelSearch && mode === "keyword" && !usePerFieldKeywords && !keyword.trim())
        }>
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

function ChannelManagerTab() {
  const [channels, setChannels] = useState([]);
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
      if (data.length && !data.some((c) => c.id === selectedId)) {
        setSelectedId("");
        setName("");
        setId("");
      }
    } catch {
      // ignore
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
                <div className="description" style={{ marginTop: 10 }}>
                  {channel.description}
                </div>
              )}
              {channel.playlists?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Public playlists</h3>
                  <div className="description" style={{ marginTop: 0, maxHeight: "none" }}>
                    {channel.playlists.map((playlist) => (
                      <div key={playlist.playlistId} style={{ marginBottom: 10 }}>
                        <div><b>ID:</b> {playlist.playlistId}</div>
                        <div><b>URL:</b> <a href={playlist.playlistUrl} target="_blank" rel="noreferrer">{playlist.playlistUrl}</a></div>
                        <div><b>Title:</b> {playlist.title}</div>
                        <div><b>Channel ID:</b> {playlist.channelId}</div>
                        <div><b>Published at:</b> {playlist.publishedAt}</div>
                        <div><b>Video count:</b> {playlist.videoCount}</div>
                      </div>
                    ))}
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

function CommentsTab() {
  const [input, setInput] = useState("");
  const [commentsData, setCommentsData] = useState(null);
  const [loadedThreads, setLoadedThreads] = useState([]);
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
  const [totalThreads, setTotalThreads] = useState(null);
  const [replyPages, setReplyPages] = useState({});
  const { isNearBottom } = useInfiniteScroll({ enabled: hasMore });

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
      const pageCommentCount = (data.threads || []).reduce(
        (total, thread) => total + 1 + thread.replies.length,
        0
      );
      setLoadedThreads((prev) => [...prev, ...(data.threads || [])]);
      setCommentsData((prev) => ({
        commentCount: (prev?.commentCount || 0) + pageCommentCount,
        threadCount: (prev?.threadCount || 0) + (data.threads?.length || 0),
      }));
      setNextPageToken(data.nextPageToken || null);
      setHasMore(Boolean(data.hasMore));
      setTotalThreads(data.totalThreads || null);
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
    setCommentsData(null);
    setLoadedThreads([]);
    setNextPageToken(null);
    setHasMore(false);
    setTotalThreads(null);
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
              setCommentsData(null);
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
            Reset Filters
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {commentsData && (
        <div style={{ marginTop: 16 }}>
          <p className="result-count">
            Comment count: {commentsData.commentCount}
            {totalThreads ? ` · Total threads: ${totalThreads}` : ""}
          </p>
          <p className="result-count">Loaded threads: {commentsData.threadCount}</p>
          {loadedThreads.map((thread) => (
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
              <div className="description" style={{ marginTop: 10 }}>{thread.textDisplay}</div>
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

function RepliesList({ thread, replyState, loadMoreReplies }) {
  const { containerRef, isNearBottom } = useInfiniteScroll({ enabled: replyState.hasMore && !replyState.loading, threshold: 0.9 });

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
          <div className="description" style={{ marginTop: 10 }}>{reply.textDisplay}</div>
        </div>
      ))}
      {replyState.loading && <div className="message-box secondary" style={{ marginTop: 10 }}>Loading replies...</div>}
      {!replyState.loading && replyState.hasMore && replyState.replies.length > 0 && (
        <div className="message-box secondary" style={{ marginTop: 10 }}>Scroll for more replies</div>
      )}
    </div>
  );
}

function PlaylistTab() {
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setData(null);
    setLoading(true);
    try {
      const result = await apiGet("playlist", { q: input });
      setData(result);
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
      {data && (
        <>
          {data.playlistInfo && Object.keys(data.playlistInfo).length > 0 && (
            <div className="panel" style={{ marginTop: 16, background: "var(--panel-2)" }}>
              <h3>Playlist Details</h3>
              <div className="meta-grid">
                <span><b>Playlist ID:</b> {data.playlistInfo.playlistId}</span>
                <span><b>Title:</b> {data.playlistInfo.title}</span>
                <span><b>Channel ID:</b> {data.playlistInfo.channelId}</span>
                <span><b>Published At:</b> {data.playlistInfo.publishedAt}</span>
              </div>
            </div>
          )}
          <p className="result-count" style={{ marginTop: 16 }}>Video count: {data.videos.length}</p>
          {data.videos.map((v) => (
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
      {tab === "manageChannels" && <ChannelManagerTab />}
      {tab === "channel" && <ChannelTab />}
      {tab === "comment" && <CommentTab />}
      {tab === "comments" && <CommentsTab />}
      {tab === "playlist" && <PlaylistTab />}
    </div>
  );
}