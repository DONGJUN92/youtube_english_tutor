/**
 * Production / custom-domain hosts cannot use the baked grok_preview broker
 * client or the in-memory PGLite DB (both fail on Vercel). Those hosts run
 * device-local accounts + IndexedDB instead.
 */
export function computeDeviceMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("device") === "1") sessionStorage.setItem("tubeshadow.deviceMode", "1");
    if (params.get("device") === "0") sessionStorage.removeItem("tubeshadow.deviceMode");
    if (sessionStorage.getItem("tubeshadow.deviceMode") === "1") return true;
  } catch {
    /* ignore */
  }
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false;
  if (host.endsWith(".grok-sandbox.com")) return false;
  return true;
}
