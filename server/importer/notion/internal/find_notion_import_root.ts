import {unzipSync} from "fflate";

const maxNotionImportRootRecursionDepth = 5;

/**
 * Recursively searches through a zip buffer (including nested zips)
 * to find the root of a Notion export, identified by containing an
 * `index.html` file. Returns the unzipped files at that level with
 * the root directory stripped from all paths, or `null` if no
 * `index.html` is found.
 *
 * For example, if the zip contains:
 *   - `Export-123/index.html`
 *   - `Export-123/Page abc.md`
 *
 * The returned files will have paths:
 *   - `index.html`
 *   - `Page abc.md`
 *
 * @see README.md "How Notion Exports Work" section for the double-nested zip structure.
 * @see README.md "Multi-Part Exports" section for why we need recursive unzipping.
 */
export function findNotionImportRoot(
    data: Uint8Array,
    depth: number = 0,
): Record<string, Uint8Array> | null {
    if (depth > maxNotionImportRootRecursionDepth) return null;

    const files = unzipSync(data);

    const rootPath = findIndexHtmlRootPath(files);
    if (rootPath !== null) {
        return stripRootPathFromFiles(files, rootPath);
    }

    for (const [name, content] of Object.entries(files)) {
        if (!name.endsWith(".zip")) continue;
        const result = findNotionImportRoot(content, depth + 1);
        if (result) {
            return result;
        }
    }

    return null;
}

/**
 * Finds the root path (directory containing index.html) in the files.
 * Returns empty string if index.html is at root, or "path/to/dir/" if nested.
 * Returns null if no index.html is found.
 */
function findIndexHtmlRootPath(files: Record<string, Uint8Array>): string | null {
    for (const name of Object.keys(files)) {
        if (name === "index.html") {
            return "";
        }
        if (name.endsWith("/index.html")) {
            return name.slice(0, -"index.html".length);
        }
    }
    return null;
}

/**
 * Returns a new files object with the root path stripped from all keys.
 */
function stripRootPathFromFiles(
    files: Record<string, Uint8Array>,
    rootPath: string,
): Record<string, Uint8Array> {
    if (rootPath === "") {
        return files;
    }

    const result: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
        if (path.startsWith(rootPath)) {
            const strippedPath = path.slice(rootPath.length);
            // Skip the root directory entry itself (empty path after stripping)
            if (strippedPath !== "") {
                result[strippedPath] = content;
            }
        }
    }
    return result;
}
