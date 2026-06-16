import React, { useEffect, useState } from "react";

const PROXY_PREFIX = "/api/proxy-image?url=";

export default function ImageWithFallback({ src, alt, className, style, ...props }) {
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  const handleError = () => {
    if (!currentSrc?.startsWith(PROXY_PREFIX) && src) {
      setCurrentSrc(`${PROXY_PREFIX}${encodeURIComponent(src)}`);
    }
  };

  if (!src) return null;

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      onError={handleError}
      {...props}
    />
  );
}
