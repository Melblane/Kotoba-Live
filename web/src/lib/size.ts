import { useEffect, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Size of a window's viewport. Pass the Picture-in-Picture window to follow that one instead. */
export function useViewportSize(win?: Window | null): Size {
  const target = win ?? window;
  const [size, setSize] = useState<Size>({ width: target.innerWidth, height: target.innerHeight });
  useEffect(() => {
    const update = () => setSize({ width: target.innerWidth, height: target.innerHeight });
    update();
    target.addEventListener('resize', update);
    return () => target.removeEventListener('resize', update);
  }, [target]);
  return size;
}

export function useElementSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
