import {loadDocumentationMarkdown} from "~/app/docs/load_docs_markdown.server.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

/**
 * Load a docs markdown page and return it as a Remix resource response.
 */
export async function loadDocumentationMarkdownResponse(pathname: string): Promise<Response> {
    const markdown = await loadDocumentationMarkdown(pathname);
    if (markdown === null) throw notFoundResponse();

    return new Response(markdown, {
        status: 200,
        headers: {"content-type": "text/markdown; charset=utf-8"},
    });
}
