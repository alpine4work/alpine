export type DocumentationOpenGraphImageRoute = {
    route: string;
    url: URL;
};

/**
 * Map a page-relative Open Graph image URL to its internal Remix resource route.
 */
export function getDocumentationOpenGraphImageRoute(
    url: URL,
): DocumentationOpenGraphImageRoute | null {
    const openGraphImageSuffix = "/og.png";
    if (!url.pathname.endsWith(openGraphImageSuffix)) return null;
    if (!url.pathname.startsWith("/docs/") && !url.pathname.startsWith("/blog/")) return null;

    const pagePath = url.pathname.slice(0, -openGraphImageSuffix.length);
    const openGraphImageUrl = new URL(url);
    openGraphImageUrl.pathname = `/og${pagePath}.png`;
    const route = url.pathname.startsWith("/docs/") ? "/docs/*/og.png" : "/blog/*/og.png";
    return {route, url: openGraphImageUrl};
}
