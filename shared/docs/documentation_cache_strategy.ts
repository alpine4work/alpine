import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * The complete caching strategy for public documentation surfaces.
 *
 * Documentation has four kinds of responses:
 *
 * - `UserDocument`: Documentation and blog content is public, but Remix serializes
 *   root loader data into the complete HTML document. That data includes the
 *   request-specific `browserId`, `initialAppRenderId`, `initialTime`, and
 *   `clientInfo`. Until public routes use a request-invariant root shell, browsers
 *   and shared caches must not store the complete HTML response.
 * - `GeneratedMetadata`: Loader JSON, Markdown, and the sitemap contain only
 *   build-generated public data. Browsers may briefly reuse them and Cloudflare
 *   may retain them between requests.
 * - `stableMedia`: Open Graph images and author-facing aliases may be replaced at
 *   the same URL by a later deploy. Their finite TTL bounds how long old bytes can
 *   remain visible.
 * - `ImmutableMedia`: Responsive image URLs contain a hash of their bytes. A new
 *   image produces a new URL, so every cache may retain these responses for a
 *   year.
 *
 * Cloudflare is populated explicitly through its Cache API. That API honors
 * `Cache-Control`, but does not support `stale-while-revalidate` or
 * `stale-if-error`. Consequently `edgeCacheControl` contains only behavior the
 * Cache API actually implements. It is written only to the stored cache response;
 * clients receive `clientCacheControl`.
 */
export type DocumentationCachePolicy =
    | "UserDocument"
    | "GeneratedMetadata"
    | "StableMedia"
    | "ImmutableMedia";

export type DocumentationCacheControl = {
    clientCacheControl: string;
    edgeCacheControl: string | null;
};

/**
 * Cache name for public generated route data. Increment this only when an
 * immediate global bust is more important than retaining the warm cache.
 */
export const documentationCacheName = "documentation_v1";

/**
 * Internal response header used by AppService to tell EdgeService which public
 * documentation responses are safe to put in the dedicated cache.
 */
export const documentationCachePolicyResponseHeader = "cyberworlds-documentation-cache-policy";

const documentationCacheControlByPolicy: Record<
    DocumentationCachePolicy,
    DocumentationCacheControl
> = {
    UserDocument: {
        clientCacheControl: "private, no-store",
        edgeCacheControl: null,
    },
    GeneratedMetadata: {
        clientCacheControl:
            "public, max-age=300, stale-while-revalidate=86400, stale-if-error=604800",
        edgeCacheControl: "public, max-age=604800",
    },
    StableMedia: {
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=604800",
        edgeCacheControl: "public, max-age=604800",
    },
    ImmutableMedia: {
        clientCacheControl: "public, max-age=31536000, immutable",
        edgeCacheControl: "public, max-age=31536000, immutable",
    },
};

/** Return the browser and effective Cloudflare policy for one response kind. */
export function getDocumentationCacheControl(
    policy: DocumentationCachePolicy,
): DocumentationCacheControl {
    return documentationCacheControlByPolicy[policy];
}

/**
 * Build AppService response headers and mark cacheable public responses for
 * EdgeService. EdgeService removes the internal marker before responding.
 */
export function getDocumentationResponseCacheHeaders(
    policy: DocumentationCachePolicy,
): Record<string, string> {
    const {clientCacheControl, edgeCacheControl} = getDocumentationCacheControl(policy);
    return {
        "cache-control": clientCacheControl,
        ...(edgeCacheControl === null ? {} : {[documentationCachePolicyResponseHeader]: policy}),
    };
}

/**
 * Parse a present internal policy header without trusting arbitrary response
 * input.
 */
export function parseDocumentationCachePolicy(value: string): DocumentationCachePolicy {
    switch (value) {
        case "UserDocument":
        case "GeneratedMetadata":
        case "StableMedia":
        case "ImmutableMedia":
            return value;
    }

    throw new InternalError(quote`Unrecognized \`DocumentationCachePolicy\` type ${value}`);
}

/**
 * Classify stable documentation media that exists in the app static manifest.
 *
 * Additional content-addressed image and maintained-alias cases are added by the
 * branches that introduce those outputs.
 */
export function getDocumentationStaticCachePolicy(
    pathname: string,
): DocumentationCachePolicy | null {
    if (
        (pathname.startsWith("/docs/") || pathname.startsWith("/blog/")) &&
        pathname.endsWith("/og.png")
    ) {
        return "StableMedia";
    }
    return null;
}
