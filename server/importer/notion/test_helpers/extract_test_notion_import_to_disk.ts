import {mkdir, readFile, readdir, writeFile} from "fs/promises";
import {join as joinPath} from "path";

import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

let testCounter = 0;

/**
 * Extracts a test Notion import zip to disk using the same path as production
 * (unzip + normalize). Returns the unzipped directory path and a list of file
 * paths.
 */
export async function extractTestNotionImportToDisk(zip: Uint8Array): Promise<{
    diskPath: string;
    filePaths: Array<string>;
}> {
    const testTmpDir = assertExists(process.env.TEST_TMPDIR, "TEST_TMPDIR must be set");

    const testDir = joinPath(testTmpDir, `extract-import-${testCounter++}`);
    const zipPath = joinPath(testDir, "import.zip");
    const unzipDir = joinPath(testDir, "unzipped");

    await mkdir(testDir, {recursive: true});
    await mkdir(unzipDir, {recursive: true});

    await writeFile(zipPath, zip);
    await unzipToDisk(zipPath, unzipDir);
    await normalizeNotionExportDirectory(unzipDir);

    const filePaths = await listFilesRecursive(unzipDir);

    return {diskPath: unzipDir, filePaths};
}

/**
 * Reads index.html from an extracted test Notion import on disk.
 */
export async function readTestNotionImportIndexHtml(
    diskPath: string,
    filePaths: Array<string>,
): Promise<Uint8Array | null> {
    const indexHtmlPath = filePaths.find(p => p === "index.html" || p.endsWith("/index.html"));
    if (!indexHtmlPath) return null;

    const buffer = await readFile(joinPath(diskPath, indexHtmlPath));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Creates a `readFile` function for use with
 * `computeNotionImportExpectedStatistics` that reads from the given disk path.
 */
export function createDiskReadFile(
    diskPath: string,
): (relativePath: string) => Promise<Uint8Array | null> {
    return async (relativePath: string) => {
        const buffer = await readFile(joinPath(diskPath, relativePath)).catch(() => null);
        if (!buffer) return null;
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    };
}

async function listFilesRecursive(dir: string, prefix = ""): Promise<Array<string>> {
    const entries = await readdir(dir, {withFileTypes: true});
    const results: Array<string> = [];
    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...(await listFilesRecursive(joinPath(dir, entry.name), relativePath)));
        } else if (entry.isFile()) {
            results.push(relativePath);
        }
    }
    return results;
}
