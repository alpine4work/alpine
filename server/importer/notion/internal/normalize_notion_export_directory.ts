import {readdir, rename, rmdir, stat, unlink} from "fs/promises";
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
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] Starting normalization of: ${diskPath}`);

    // Log initial state
    let entries = await readdir(diskPath, {withFileTypes: true});
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] Initial root contents (${entries.length} entries):`);
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const children = await readdir(joinPath(diskPath, entry.name));
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(`[normalize]   DIR: ${entry.name}/ (${children.length} children)`);
            for (const child of children.slice(0, 10)) {
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(`[normalize]     - ${child}`);
            }
            if (children.length > 10) {
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(`[normalize]     ... and ${children.length - 10} more`);
            }
        } else {
            const fileSize = await stat(joinPath(diskPath, entry.name))
                .then(s => s.size)
                .catch(() => -1);
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(`[normalize]   FILE: ${entry.name} (${fileSize} bytes)`);
        }
    }

    // Step 1: Find and extract any nested zip files (e.g., Export-xxx-Part-1.zip)
    // Extract into the same directory so multi-part exports merge together
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] Step 1: Looking for nested .zip files at root...`);
    entries = await readdir(diskPath, {withFileTypes: true});
    let zipsExtracted = 0;
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".zip")) {
            const nestedZipPath = joinPath(diskPath, entry.name);
            const zipSize = await stat(nestedZipPath)
                .then(s => s.size)
                .catch(() => -1);
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(
                `[normalize] Step 1: Found nested zip: ${entry.name} (${zipSize} bytes). Extracting...`,
            );
            // Extract directly into diskPath (not a subdirectory)
            await unzipToDisk(nestedZipPath, diskPath);
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(`[normalize] Step 1: Extracted ${entry.name}. Deleting zip...`);
            // Remove the nested zip file after extraction
            await unlink(nestedZipPath);
            zipsExtracted++;
        }
    }
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] Step 1 complete. Extracted ${zipsExtracted} zip files.`);

    // Log state after Step 1
    entries = await readdir(diskPath, {withFileTypes: true});
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] After Step 1, root contents (${entries.length} entries):`);
    let mdCount = 0;
    let csvCount = 0;
    let dirCount = 0;
    let zipCount = 0;
    let otherCount = 0;
    for (const entry of entries) {
        if (entry.isDirectory()) {
            dirCount++;
            const children = await readdir(joinPath(diskPath, entry.name));
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(`[normalize]   DIR: ${entry.name}/ (${children.length} children)`);
            // Count file types inside the directory
            let subMd = 0;
            let subCsv = 0;
            let subZip = 0;
            let subOther = 0;
            for (const child of children) {
                if (child.endsWith(".md")) subMd++;
                else if (child.endsWith(".csv")) subCsv++;
                else if (child.endsWith(".zip")) subZip++;
                else subOther++;
            }
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(
                `[normalize]     Breakdown: ${subMd} .md, ${subCsv} .csv, ${subZip} .zip, ${subOther} other`,
            );
        } else if (entry.name.endsWith(".md")) {
            mdCount++;
        } else if (entry.name.endsWith(".csv")) {
            csvCount++;
        } else if (entry.name.endsWith(".zip")) {
            zipCount++;
        } else {
            otherCount++;
        }
    }
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(
        `[normalize] Root file summary: ${mdCount} .md, ${csvCount} .csv, ${zipCount} .zip, ${otherCount} other, ${dirCount} dirs`,
    );

    // Step 2: Move files from any "Export-xxx/" directories to the root. Multi-part
    // exports may have multiple Export directories.
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] Step 2: Looking for Export-xxx/ directories to flatten...`);
    entries = await readdir(diskPath, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("Export-")) {
            const exportDirectoryPath = joinPath(diskPath, entry.name);

            // Move all contents from Export-xxx/ to the root
            const exportContents = await readdir(exportDirectoryPath, {withFileTypes: true});
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(
                `[normalize] Step 2: Flattening ${entry.name}/ (${exportContents.length} items)`,
            );
            for (const item of exportContents) {
                const oldPath = joinPath(exportDirectoryPath, item.name);
                const newPath = joinPath(diskPath, item.name);
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(
                    `[normalize] Step 2:   rename ${item.name} (${item.isDirectory() ? "dir" : "file"})`,
                );
                await rename(oldPath, newPath);
            }

            // Remove the now-empty Export-xxx directory
            await rmdir(exportDirectoryPath);
            // TODO: delete this log
            // eslint-disable-next-line no-console
            console.log(`[normalize] Step 2: Removed empty ${entry.name}/`);
        }
    }

    // Log final state
    entries = await readdir(diskPath, {withFileTypes: true});
    mdCount = 0;
    csvCount = 0;
    dirCount = 0;
    zipCount = 0;
    otherCount = 0;
    for (const entry of entries) {
        if (entry.isDirectory()) {
            dirCount++;
        } else if (entry.name.endsWith(".md")) {
            mdCount++;
        } else if (entry.name.endsWith(".csv")) {
            csvCount++;
        } else if (entry.name.endsWith(".zip")) {
            zipCount++;
        } else {
            otherCount++;
        }
    }
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[normalize] FINAL root state (${entries.length} entries):`);
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(
        `[normalize]   ${mdCount} .md, ${csvCount} .csv, ${zipCount} .zip, ${otherCount} other files, ${dirCount} directories`,
    );
    // Log first few entries as samples
    for (const entry of entries.slice(0, 10)) {
        // TODO: delete this log
        // eslint-disable-next-line no-console
        console.log(`[normalize]   ${entry.isDirectory() ? "DIR" : "FILE"}: ${entry.name}`);
    }
    if (entries.length > 10) {
        // TODO: delete this log
        // eslint-disable-next-line no-console
        console.log(`[normalize]   ... and ${entries.length - 10} more`);
    }
}
