/**
 * Resolves a relative path against a base directory for Notion imports. Handles
 * `../` parent directory references and subdirectory paths.
 *
 * @param baseDir - The directory to resolve from (e.g., "path/to/dir") @param
 * relativePath - The relative path (e.g., "../other/file.md") @returns The
 * resolved absolute path, or null if the path goes above root
 */
export function resolveNotionImportRelativePath(
    baseDir: string,
    relativePath: string,
): string | null {
    // Split into segments
    const baseParts = baseDir ? baseDir.split("/") : [];
    const relativeParts = relativePath.split("/");

    // Process relative path segments
    const resultParts = [...baseParts];
    for (const part of relativeParts) {
        if (part === "..") {
            // Go up one directory
            if (resultParts.length === 0) {
                // Can't go above root
                return null;
            }
            resultParts.pop();
        } else if (part !== "." && part !== "") {
            // Normal segment
            resultParts.push(part);
        }
    }

    return resultParts.join("/");
}
