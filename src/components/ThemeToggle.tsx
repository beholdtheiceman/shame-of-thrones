"use client";

export function ThemeToggle() {
  function toggle() {
    const current =
      document.documentElement.getAttribute("data-theme") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem("sot-theme", next);
    } catch {
      // storage unavailable — theme still applies for this session
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex h-7 w-7 items-center justify-center rounded-full border border-vellum-line text-xs text-ink-soft"
    >
      🌓
    </button>
  );
}
