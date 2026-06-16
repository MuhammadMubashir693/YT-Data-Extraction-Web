import { useEffect, useRef, useState } from "react";

export function useInfiniteScroll({ threshold = 0.8, enabled = true }) {
  const [isNearBottom, setIsNearBottom] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef.current || window;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container === window
        ? { scrollTop: window.scrollY, scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight }
        : container;
      if (scrollHeight === 0) return;
      setIsNearBottom((scrollTop + clientHeight) / scrollHeight >= threshold);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [threshold, enabled]);

  return { containerRef, isNearBottom };
}
