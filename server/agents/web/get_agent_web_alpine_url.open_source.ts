/**
 * The base URL of the Alpine product for the environment we're running in, with no
 * trailing slash. Links we hand to a person need to point at the environment
 * they're actually using, otherwise a link generated in development sends them to
 * production.
 *
 * The agent sandbox sets `ALPINE_URL` from the edge service URL. When it isn't
 * set—like the CLI running against production from someone's own machine—fall back
 * to the production URL.
 */
export function getAgentWebAlpineUrl(): string {
    // Trim any trailing slash so callers can append a pathname without doubling up the
    // separator.
    return (process.env.ALPINE_URL ?? "https://alpine.inc").replace(/\/+$/, "");
}
