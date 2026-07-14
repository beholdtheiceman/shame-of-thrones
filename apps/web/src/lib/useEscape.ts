"use client";

import { useEffect, useRef } from "react";

// Overlay stack: later-mounted overlays sit on top, and Escape only closes
// the topmost one — so Esc in a Report modal doesn't also close the
// ThroneSheet underneath it.
const stack: symbol[] = [];

/** Closes an overlay on Escape. Attach once per open overlay. */
export function useEscape(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol("overlay");
    stack.push(id);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && stack[stack.length - 1] === id) closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      const i = stack.indexOf(id);
      if (i !== -1) stack.splice(i, 1);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
