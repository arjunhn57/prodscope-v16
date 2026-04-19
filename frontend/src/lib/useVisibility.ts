import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * True when the element is near the viewport. Fires once by default; pass
 * `{ once: false }` to track entry/exit repeatedly.
 */
export function useInViewport<T extends Element>(
  options: { rootMargin?: string; threshold?: number; once?: boolean } = {}
): [RefObject<T | null>, boolean] {
  const { rootMargin = "200px", threshold = 0, once = false } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, threshold, once]);

  return [ref, inView];
}

/** True while the tab is visible. */
export function usePageActive(): boolean {
  const [active, setActive] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden
  );

  useEffect(() => {
    const onChange = () => setActive(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return active;
}
