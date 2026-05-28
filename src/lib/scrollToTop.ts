// Scroll the app shell back to the top.
//
// The app's Layout uses `<main className="overflow-y-auto">` as the actual
// scroll container, so window.scrollTo is usually a no-op. We scroll both
// to be resilient to future layout changes and to edge cases (e.g. iOS
// PWAs where document-level scrolling sometimes kicks in).
export function scrollAppToTop(): void {
  document.querySelector('main')?.scrollTo({ top: 0, left: 0 });
  window.scrollTo({ top: 0, left: 0 });
}
