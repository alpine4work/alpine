import {strFromU8} from "fflate";
import {mkdir, writeFile} from "fs/promises";
import {dirname, join as joinPath} from "path";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";
import {generateDeterministicNotionFileIdSync} from "~/server/importer/notion/internal/generate_deterministic_notion_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const oneGigabyte = 1024 * 1024 * 1024;

/** Abort image downloads that take longer than 30 seconds. */
const downloadTimeoutMs = 30_000;

/**
 * Returns true if the URL's hostname is an IP address or localhost. Only
 * domain-name hosts are allowed to prevent SSRF attacks against internal services,
 * cloud metadata endpoints, or local ports.
 */
function isIpUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return true;
    }

    const hostname = parsed.hostname;

    if (hostname === "localhost") return true;
    // IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
    // IPv6 (brackets in URL hostname)
    if (hostname.startsWith("[")) return true;

    return false;
}

/**
 * Matches markdown links with external URLs:
 *
 * - `[Image](https://...)` — Notion's pattern for externally hosted images
 * - `![alt](https://...)` — standard markdown image syntax with external URLs
 *
 * The URL portion allows balanced parentheses so URLs like
 * `https://example.com/image(1).png` are captured correctly.
 *
 * Capture groups:
 *
 * 1. Full bracket part including optional `!`: `![alt]` or `[Image]`
 * 2. The alt/link text: `alt` or `Image`
 * 3. The URL: `https://...`
 */
const externalImageLinkPattern = /(!?\[([^\]]*)\])\((https?:\/\/(?:[^()]*|\([^()]*\))*)\)/g;

/**
 * Content types we consider downloadable images.
 */
const imageContentTypes = new Set([
    "image/apng",
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/heif",
    "image/ico",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/tiff",
    "image/webp",
]);

/**
 * Maps image content types to file extensions.
 */
const extensionByContentType: Record<string, string> = {
    "image/apng": "apng",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heif": "heif",
    "image/ico": "ico",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "image/webp": "webp",
};

/**
 * Information about a downloaded external image file.
 */
export interface DownloadedExternalImage {
    /** The relative path where the file was saved on disk. */
    relativePath: string;
    /** The pre-assigned deterministic file ID. */
    id: FileId;
}

type ImageMatch = {fullMatch: string; altText: string; url: string};

/**
 * Downloads external images referenced in Notion markdown files and rewrites the
 * markdown to reference local file paths instead.
 *
 * Notion exports sometimes include images as external URLs rather than local files
 * (e.g. `[Image](https://images.openai.com/...)`). This function downloads those
 * images so they can be uploaded to Alpine's file storage alongside the rest of
 * the import.
 *
 * Images are only downloaded if:
 *
 * - The URL uses a domain name (IP addresses are blocked to prevent SSRF)
 * - The response content-type is a recognized image type
 * - The file size is under 1 GB
 * - The download completes within 30 seconds
 *
 * If the download fails or the file is too large, the original link is left
 * unchanged in the markdown.
 *
 * The function rewrites the markdown files on disk so that later phases (upload +
 * conversion) see local file paths and handle them through the existing pipeline.
 *
 * @returns A map of downloaded files keyed by relative path, each containing the
 * file ID assigned to that file.
 */
export async function downloadExternalNotionImportImages(
    context: {importerService: ImporterServiceContextModuleBase},
    diskPathToUnzippedFiles: string,
    markdownPaths: Array<string>,
    spaceId: SpaceId,
    workspaceId: string,
    createdTime: number,
    fetchFn: typeof fetch = fetch,
): Promise<Map<string, DownloadedExternalImage>> {
    // Phase 1: Scan all markdown files and collect image URLs.
    const matchesByFile = new Map<string, {markdown: string; matches: Array<ImageMatch>}>();
    const uniqueUrls = new Set<string>();

    for (const mdPath of markdownPaths) {
        const content = await context.importerService.readUnzippedFile({
            diskPathToUnzippedFiles,
            relativeFilePath: mdPath,
        });
        if (!content) continue;

        const markdown = strFromU8(content);
        externalImageLinkPattern.lastIndex = 0;

        const allMatches = [...markdown.matchAll(externalImageLinkPattern)];
        if (allMatches.length === 0) continue;

        // Filter to only matches that look like images. Notion specifically uses
        // `[Image](url)` for external images. We also handle `![...](url)`.
        const imageMatches: Array<ImageMatch> = allMatches
            .filter(match => match[0].startsWith("!") || match[2] === "Image")
            .map(match => ({fullMatch: match[0], altText: match[2]!, url: match[3]!}));

        if (imageMatches.length === 0) continue;

        matchesByFile.set(mdPath, {markdown, matches: imageMatches});
        for (const m of imageMatches) uniqueUrls.add(m.url);
    }

    if (uniqueUrls.size === 0) return new Map();

    // Phase 2: Download all unique URLs in parallel.
    const downloadsByUrl = new Map<string, {data: Uint8Array; extension: string}>();
    await runAllPromises(
        [...uniqueUrls].map(async url => {
            const result = await downloadExternalImage(url, fetchFn);
            if (result) downloadsByUrl.set(url, result);
        }),
    );

    // Phase 3: Write downloaded images to disk and rewrite markdown files.
    const downloadedFiles = new Map<string, DownloadedExternalImage>();

    for (const [mdPath, {markdown, matches}] of matchesByFile) {
        const currentDir = mdPath.includes("/") ? mdPath.slice(0, mdPath.lastIndexOf("/")) : "";
        let modifiedMarkdown = markdown;

        for (const {fullMatch, altText, url} of matches) {
            const downloaded = downloadsByUrl.get(url);
            if (!downloaded) continue;

            const hash = simpleStringHash(url);
            const fileName = `_downloaded_${hash}.${downloaded.extension}`;
            const relativePath = currentDir ? `${currentDir}/${fileName}` : fileName;

            // Write the image to disk if not already written at this path.
            if (!downloadedFiles.has(relativePath)) {
                const absolutePath = joinPath(diskPathToUnzippedFiles, relativePath);
                await mkdir(dirname(absolutePath), {recursive: true});
                await writeFile(absolutePath, downloaded.data);

                const fileId = generateDeterministicNotionFileIdSync(
                    spaceId,
                    workspaceId,
                    `file:${relativePath}`,
                    createdTime,
                );

                downloadedFiles.set(relativePath, {relativePath, id: fileId});
            }

            // Rewrite to point to the local file. Use link syntax (not image syntax) because
            // our markdown parser doesn't support inline images/videos/files directly. It only
            // recognizes files via URLs matching our alpine.inc format. Link syntax preserves
            // the URL as a Text element with a Link mark, which the conversion phase uses for
            // file resolution.
            modifiedMarkdown = modifiedMarkdown.replace(
                fullMatch,
                `[${altText}](${encodeURIComponent(fileName)})`,
            );
        }

        // Write the modified markdown back to disk so the conversion phase reads the
        // updated content.
        if (modifiedMarkdown !== markdown) {
            await writeFile(
                joinPath(diskPathToUnzippedFiles, mdPath),
                new TextEncoder().encode(modifiedMarkdown),
            );
        }
    }

    return downloadedFiles;
}

/**
 * Attempts to download an external image URL. Returns the image data and extension
 * if successful, or null if the download should be skipped (too large, not an
 * image, network error, etc.).
 *
 * This is a best effort to download the image. If it fails, we don't want to fail
 * the entire import due to something out of our control.
 *
 * Uses a single GET request rather than HEAD-then-GET because some CDNs (notably
 * OpenAI's image CDN) return 405 Method Not Allowed for HEAD requests. We check
 * the response headers before consuming the body and bail early if the content
 * type isn't an image or the declared size exceeds the limit.
 */
async function downloadExternalImage(
    url: string,
    fetchFn: typeof fetch,
): Promise<{data: Uint8Array; extension: string} | null> {
    try {
        if (isIpUrl(url)) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), downloadTimeoutMs);

        try {
            const response = await fetchFn(url, {signal: controller.signal});
            if (!response.ok) return null;

            const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
            if (!imageContentTypes.has(contentType)) return null;

            // Check content-length header before downloading the body. Not all servers send
            // this header, so we only reject when the declared size is clearly over the limit.
            const declaredLength = Number(response.headers.get("content-length") ?? "0");
            if (declaredLength >= oneGigabyte) return null;

            const extension = extensionByContentType[contentType];
            if (!extension) return null;

            const buffer = await response.arrayBuffer();
            if (buffer.byteLength >= oneGigabyte) return null;

            return {data: new Uint8Array(buffer), extension};
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        // Network errors, timeouts, aborts, etc. — leave the link as-is. If it did happen
        // to fail, let's not fail the entire import due to something out of our control.
        return null;
    }
}

/**
 * Simple string hash that produces a short, deterministic, URL-safe string. Uses
 * FNV-1a to produce two 32-bit hashes combined into a hex string.
 */
function simpleStringHash(input: string): string {
    const h1 = fnv1a(input + ":0");
    const h2 = fnv1a(input + ":1");
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function fnv1a(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash;
}
