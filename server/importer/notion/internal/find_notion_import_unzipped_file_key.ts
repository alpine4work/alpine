/**
 * Find the full file key in unzipped Notion import files that matches the given path.
 *
 * Notion exports have a root directory prefix (e.g., "Export-<uuid>/") that we
 * strip during processing, but the unzipped files still have the original
 * keys. This function handles both exact matches and prefixed matches.
 *
 * @see README.md "How Notion Exports Work" section for the export directory structure.
 *
 * @param unzippedFiles - The unzipped file contents keyed by path
 * @param filePath - The file path to find (without root prefix)
 * @returns The full key in unzippedFiles, or undefined if not found
 */
export function findNotionImportUnzippedFileKey(
    unzippedFiles: Record<string, Uint8Array>,
    filePath: string,
): string | undefined {
    // Try exact match first
    if (filePath in unzippedFiles) return filePath;

    // Try with root directory prefix
    for (const key of Object.keys(unzippedFiles)) {
        if (key.endsWith(`/${filePath}`) || key === filePath) {
            return key;
        }
    }

    return undefined;
}
