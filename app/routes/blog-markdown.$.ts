import {loadDocumentationMarkdownResponse} from "~/app/docs/load_docs_markdown_response.server.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export function loader({request}: LoaderArgs) {
    const pathname = new URL(request.url).pathname.replace(/^\/blog-markdown\//, "/blog/");
    return loadDocumentationMarkdownResponse(pathname);
}
