import React from "react";

const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

function normalizeUrl(raw) {
  if (!raw) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  return raw;
}

function stripTrailingPunctuation(text) {
  return text.replace(/[.,;:!?]+$/g, "");
}

export default function LinkifiedText({ text, className, ...props }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = URL_REGEX.exec(text)) !== null) {
    const rawUrl = match[0];
    const start = match.index;
    const end = start + rawUrl.length;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const cleanUrl = stripTrailingPunctuation(rawUrl);
    const suffix = rawUrl.slice(cleanUrl.length);
    const normalizedUrl = normalizeUrl(cleanUrl);

    parts.push(
      <a key={`${start}-${end}`} href={normalizedUrl} target="_blank" rel="noreferrer">
        {cleanUrl}
      </a>
    );

    if (suffix) {
      parts.push(suffix);
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
