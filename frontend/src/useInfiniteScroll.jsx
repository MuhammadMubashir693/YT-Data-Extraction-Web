import { useEffect, useRef, useState } from "react";

// Hook that reports whether the user has scrolled near the bottom of the
// page or an optional container. Returns a `containerRef` you can attach
// to a scrollable element and an `isNearBottom` boolean that flips true
// when the scroll position crosses the `threshold` fraction.
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
