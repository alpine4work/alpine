const safeUrlProtocols: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/**
 * Does the URL string start with a protocol that's safe to open?
 *
 * We use this with URLs input by a user. URLs that start with `javascript://` are
 * very much not safe! It allows attackers to inject code. We allowlist safe
 * protocols instead of trying to enumerate all unsafe protocols now and into the
 * future.
 */
export function startsWithSafeUrlProtocol(url: string) {
    for (const protocol of safeUrlProtocols) {
        if (url.startsWith(`${protocol}:`)) {
            return true;
        }
    }
    return false;
}
