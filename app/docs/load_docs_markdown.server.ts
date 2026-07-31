import fs from "fs/promises";
import {join, normalize} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

// The pre-rendered markdown tree built by `//app/docs/codegen:docs_markdown`.
// Files mirror their page URL, so a `/docs/....md` or `/blog/....md` request maps
// straight to a file.
const documentationMarkdownDirectory = join(runfilesPath, "cyberworlds/app/docs/codegen/pages");

/**
 * The rendered markdown for a `/docs/....md` or `/blog/....md` request path, or
 * `null` when there is no such page. The request path only ever resolves to a file
 * inside the generated markdown directory, so a traversal like
 * `/docs/../../secret.md` can't escape it.
 */
export function loadDocumentationMarkdown(pathname: string): Promise<string | null> {
    // Decode the path so percent-encoded request paths match their file on disk. A
    // malformed escape is treated as "no such page".
    const decoded = decodeDocumentationMarkdownPathname(pathname);
    if (decoded === null) return Promise.resolve(null);

    // `/docs.md` aliases the overview page; `/blog.md` aliases the blog index.
    const requestPath =
        decoded === "/docs.md"
            ? "/docs/overview.md"
            : decoded === "/blog.md"
              ? "/blog.md"
              : decoded;
    const filePath = normalize(
        join(documentationMarkdownDirectory, requestPath.replace(/^\/+/, "")),
    );
    if (
        filePath !== documentationMarkdownDirectory &&
        !filePath.startsWith(`${documentationMarkdownDirectory}/`)
    ) {
        return Promise.resolve(null);
    }

    // A missing file is an expected "no such page" outcome (404), not an error.
    return fs.readFile(filePath, "utf8").catch(() => null);
}

/**
 * Decode a request pathname into the markdown file path encoded by docs codegen.
 */
function decodeDocumentationMarkdownPathname(pathname: string): string | null {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return null;
    }
}
