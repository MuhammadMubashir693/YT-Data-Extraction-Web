import React from "react";

// Matches, in priority order: URLs, #hashtags, and mm:ss / h:mm:ss timestamps.
// Because alternation is tried left-to-right at each position, a URL that
// happens to contain a "#fragment" is consumed whole by the URL branch
// before the hashtag branch ever gets a chance to look at it.
const TOKEN_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)|(#[A-Za-z0-9_]+)|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g;

function normalizeUrl(raw) {
  if (!raw) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  return raw;
}

function stripTrailingPunctuation(text) {
  return text.replace(/[.,;:!?]+$/g, "");
}

// Converts "mm:ss" or "h:mm:ss" into total seconds, or null if it isn't a
// plausible timestamp (e.g. seconds/minutes rolling over 59).
function timestampToSeconds(token) {
  const parts = token.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;

  const seconds = parts[parts.length - 1];
  if (seconds > 59) return null;

  if (parts.length === 3) {
    const [hours, minutes] = parts;
    if (minutes > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes] = parts;
    return minutes * 60 + seconds;
  }
  return null;
}

/**
 * Renders text with URLs, #hashtags, and timestamps turned into links.
 * Pass `videoId` to enable timestamp linking (e.g. "12:34" -> a link that
 * seeks the given video to that point); without it, timestamps are left as
 * plain text since there's no video to link them to.
 */
export default function LinkifiedText({ text, className, videoId, ...props }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const [full, urlToken, hashtagToken, timestampToken] = match;
    const start = match.index;
    const end = start + full.length;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    if (urlToken) {
      const cleanUrl = stripTrailingPunctuation(urlToken);
      const suffix = urlToken.slice(cleanUrl.length);
      const normalizedUrl = normalizeUrl(cleanUrl);

      parts.push(
        <a key={`${start}-url`} href={normalizedUrl} target="_blank" rel="noreferrer">
          {cleanUrl}
        </a>
      );

      if (suffix) {
        parts.push(suffix);
      }
    } else if (hashtagToken) {
      const tag = hashtagToken.slice(1);
      parts.push(
        <a
          key={`${start}-tag`}
          href={`https://www.youtube.com/hashtag/${encodeURIComponent(tag)}`}
          target="_blank"
          rel="noreferrer"
        >
          {hashtagToken}
        </a>
      );
    } else if (timestampToken) {
      const seconds = videoId ? timestampToSeconds(timestampToken) : null;
      if (seconds !== null) {
        parts.push(
          <a
            key={`${start}-ts`}
            href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`}
            target="_blank"
            rel="noreferrer"
          >
            {timestampToken}
          </a>
        );
      } else {
        parts.push(timestampToken);
      }
    }

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <span className={className} {...props}>
      {parts}
    </span>
  );
}