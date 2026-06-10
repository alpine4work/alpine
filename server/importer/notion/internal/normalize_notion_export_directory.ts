import {readdir, rename, rmdir, unlink} from "fs/promises";
import {join as joinPath} from "path";

import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";

/**
 * Normalizes a Notion export directory structure after unzipping.
 *
 * Notion exports have specific quirks that need handling:
 *
 * 1. **Nested zip files**: Large exports are split into multiple parts
 *    (`Export-xxx-Part-1.zip`, `Export-xxx-Part-2.zip`). These need to be
 *    extracted into the same directory so the content merges together.
 *
 * 2. **Export-xxx wrapper directories**: All content is wrapped in a directory
 *    like `Export-abc123def/`. We flatten this so files are directly in the root
 *    for consistent path handling.
 *
 * @param diskPath - Path to the unzipped export directory
 */
export async function normalizeNotionExportDirectory(diskPath: string): Promise<void> {
    // Step 1: Find and extract any nested zip files (e.g., Export-xxx-Part-1.zip)
    // Extract into the same directory so multi-part exports merge together
    let entries = await readdir(diskPath, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".zip")) {
            const nestedZipPath = joinPath(diskPath, entry.name);
            // Extract directly into diskPath (not a subdirectory)
            await unzipToDisk(nestedZipPath, diskPath);
            // Remove the nested zip file after extraction
            await unlink(nestedZipPath);
        }
    }

    // Step 2: Move files from any "Export-xxx/" directories to the root. Multi-part
    // exports may have multiple Export directories.
    entries = await readdir(diskPath, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("Export-")) {
            const exportDirectoryPath = joinPath(diskPath, entry.name);

            // Move all contents from Export-xxx/ to the root
            const exportContents = await readdir(exportDirectoryPath, {withFileTypes: true});
            for (const item of exportContents) {
                const oldPath = joinPath(exportDirectoryPath, item.name);
                const newPath = joinPath(diskPath, item.name);
                await rename(oldPath, newPath);
            }

            // Remove the now-empty Export-xxx directory
            await rmdir(exportDirectoryPath);
        }
    }
}
