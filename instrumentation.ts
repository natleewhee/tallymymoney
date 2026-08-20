// Next.js's own internal request router (node_modules/next/dist/server/lib/router-server.js)
// calls the legacy Node `url.parse()` API, which prints a DEP0169
// warning on every request in Vercel's function logs — confirmed by
// tracing it directly, not a warning from this project's own code or
// its direct dependencies. Harmless (Node explicitly notes no CVEs are
// issued for it) but noisy enough to obscure real log output while
// debugging. Runs once at server startup, before any request is routed.
export function register() {
  process.noDeprecation = true;
}
