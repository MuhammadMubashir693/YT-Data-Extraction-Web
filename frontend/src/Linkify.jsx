import React from "react";

// Matches http(s):// URLs and bare www. URLs. Trailing punctuation that is
// unlikely to be part of a URL is trimmed and kept as plain text.
const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const TRAILING_PUNCT = /[.,!?;:'")\]}]+$/;

export default function Linkify({ text }) {
  if (text == null) return null;
  const str = String(text);

  const nodes = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(str)) !== null) {
    const start = match.index;
    let url = match[0];

    // Keep trailing punctuation out of the link.
    let trailing = "";
    const trailMatch = url.match(TRAILING_PUNCT);
    if (trailMatch) {
      trailing = trailMatch[0];
      url = url.slice(0, url.length - trailing.length);
    }
    // Balance unmatched closing parens (e.g. "(see http://a.com/x)").
    if (url.endsWith(")")) {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        trailing = ")" + trailing;
      }
    }

    if (start > lastIndex) {
      nodes.push(str.slice(lastIndex, start));
    }

    const href = url.startsWith("www.") ? `https://${url}` : url;
    nodes.push(
      <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
        {url}
      </a>
    );

    if (trailing) nodes.push(trailing);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < str.length) {
    nodes.push(str.slice(lastIndex));
  }

  return <>{nodes}</>;
}
