// Google Analytics 4 custom events. index.html loads gtag.js only on the
// live site (studio.sonyasupposedly.com), so in development these calls do
// nothing.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export type EventName =
  | "bubble_open"       // a card pinned open (not hover peeks)
  | "merge"             // a mashup made or fetched
  | "merge_failed"
  | "acquire"           // a bubble fed to a mouth
  | "devoured_open"
  | "about_open"
  | "copy_link"
  | "newsletter_signup"
  | "hire_me_click";

export function track(name: EventName, params: Record<string, string | number | boolean> = {}): void {
  try {
    window.gtag?.("event", name, params);
  } catch {
    // Analytics must never break the page.
  }
}
