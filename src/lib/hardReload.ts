// User-facing "I just pushed a new build, get it now" escape hatch.
//
// vite-plugin-pwa runs with `registerType: 'autoUpdate'` and Workbox precaches
// the app shell (see src/sw.ts). Auto-update normally swaps to a new SW on the
// next page load, but long-lived tabs, iOS home-screen PWAs, and a
// GitHub-Pages-cached `index.html` can keep users on a stale build. This
// helper attacks all three layers in order:
//   1. Unregister every service worker (so the next navigation re-fetches
//      sw.js from the network).
//   2. Delete every Cache Storage entry (the Workbox precache).
//   3. `location.replace` with a cache-busting query param so the HTML
//      navigation request itself misses any HTTP cache.
//
// We deliberately do NOT touch localStorage, IndexedDB, or the server-side
// push subscription, so the Supabase auth session, theme, active charity,
// and sticky customer all survive.
export async function hardReloadForUpdate(): Promise<never> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Best-effort; we still want to reload even if one step throws.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.replace(url.toString());
  // The promise intentionally never resolves; the page is navigating away.
  return new Promise<never>(() => {});
}
