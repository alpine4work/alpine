import {resolveNotionImportRelativePath} from "~/server/importer/notion/internal/resolve_notion_import_relative_path.js";

/**
 * Decode URL-encoded characters in a relative path from a markdown link.
 *
 * Markdown links encode special characters (e.g. spaces become `%20`), but the
 * actual filenames in the zip are not encoded.
 *
 * Handles lone `%` characters that aren't valid percent-encoded sequences by
 * escaping them as `%25` before decoding, so a filename like `100% Done.md`
 * decodes correctly instead of throwing.
 */
export function decodeNotionImportRelativePathUrl(url: string): string {
    // Replace lone `%` (not followed by two hex digits) with `%25` so
    // `decodeURIComponent` treats them as literal `%`.
    const sanitized = url.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
    return decodeURIComponent(sanitized);
}

/**
 * Check if a link URL points to a file in the export. Resolves URL-encoded
 * markdown link paths against the current document's directory and checks if the
 * result is a known file path. Returns the resolved path relative to the export
 * root, or null if not a file link.
 */
export function resolveNotionImportFileLinkPath(
    url: string,
    currentDir: string,
    knownPaths: {has: (path: string) => boolean},
): string | null {
    // Skip external URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return null;
    }

    // Decode URL-encoded characters in the markdown link path (e.g. `%20` → space) to
    // match filesystem paths.
    let path = decodeNotionImportRelativePathUrl(url);
    if (path.startsWith("./")) {
        path = path.slice(2);
    }

    // Try direct match first (for absolute or root-relative paths)
    if (knownPaths.has(path)) {
        return path;
    }

    // Resolve relative path against current document's directory
    const resolved = resolveNotionImportRelativePath(currentDir, path);
    if (resolved && knownPaths.has(resolved)) {
        return resolved;
    }

    return null;
}
