import {getDocumentationResponseHeaders} from "~/app/docs/documentation_response_headers.server.js";
import {loadDocumentationMarkdown} from "~/app/docs/load_docs_markdown.server.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

const documentationSiteOrigin = "https://alpine.inc";

/**
 * Load a docs markdown page and return it as a Remix resource response.
 */
export async function loadDocumentationMarkdownResponse(pathname: string): Promise<Response> {
    const markdown = await loadDocumentationMarkdown(pathname);
    if (markdown === null) throw notFoundResponse();

    const headers = new Headers(getDocumentationResponseHeaders());
    headers.set("content-type", "text/markdown; charset=utf-8");
    headers.set("link", `<${getDocumentationMarkdownCanonicalUrl(pathname)}>; rel="canonical"`);

    return new Response(markdown, {
        status: 200,
        headers,
    });
}

/**
 * Map a markdown resource pathname to the canonical HTML page it represents.
 */
function getDocumentationMarkdownCanonicalUrl(pathname: string): string {
    let canonicalPathname;
    switch (pathname) {
        case "/docs.md":
            canonicalPathname = "/docs/overview";
            break;
        case "/blog.md":
            canonicalPathname = "/blog";
            break;
        default:
            canonicalPathname = pathname.replace(/\.md$/, "");
            break;
    }
    return new URL(canonicalPathname, documentationSiteOrigin).href;
}
