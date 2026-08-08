import {strToU8, zipSync} from "fflate";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join as joinPath} from "path";

import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * Tests for normalizeNotionExportDirectory which handles Notion-specific export
 * structure quirks:
 *
 * - Extracting nested Part-N.zip files
 * - Flattening Export-xxx/ wrapper directories
 */
describe("normalizeNotionExportDirectory", () => {
    const testTmpDir = assertExists(process.env.TEST_TMPDIR);
    const workspacePath = joinPath(testTmpDir, "normalize-notion-test");

    beforeEach(() => {
        if (existsSync(workspacePath)) {
            rmSync(workspacePath, {recursive: true});
        }
        mkdirSync(workspacePath, {recursive: true});
    });

    afterAll(() => {
        if (existsSync(workspacePath)) {
            rmSync(workspacePath, {recursive: true});
        }
    });

    /**
     * Helper to create a zip file on disk and extract it.
     */
    async function createAndExtractZip(
        name: string,
        files: Record<string, Uint8Array>,
    ): Promise<string> {
        const zipData = zipSync(files);
        const zipPath = joinPath(workspacePath, `${name}.zip`);
        const extractDir = joinPath(workspacePath, name);

        writeFileSync(zipPath, zipData);
        mkdirSync(extractDir, {recursive: true});
        await unzipToDisk(zipPath, extractDir);

        return extractDir;
    }

    test("does nothing when no Export-xxx directories or nested zips exist", async () => {
        const extractDir = await createAndExtractZip("simple", {
            "index.html": strToU8("<html></html>"),
            "page.md": strToU8("# Page"),
        });

        await normalizeNotionExportDirectory(extractDir);

        // Files should remain unchanged
        expect(existsSync(joinPath(extractDir, "index.html"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "page.md"))).toBe(true);
    });

    test("flattens Export-xxx directory to root", async () => {
        const extractDir = await createAndExtractZip("export-dir", {
            "Export-abc123/index.html": strToU8("<html></html>"),
            "Export-abc123/page.md": strToU8("# Page"),
            "Export-abc123/subdir/nested.md": strToU8("# Nested"),
        });

        await normalizeNotionExportDirectory(extractDir);

        // Export-xxx directory should be flattened
        expect(existsSync(joinPath(extractDir, "index.html"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "page.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "subdir/nested.md"))).toBe(true);
        // Original Export-xxx directory should be gone
        expect(existsSync(joinPath(extractDir, "Export-abc123"))).toBe(false);
    });

    test("extracts nested zip files", async () => {
        // Create a nested zip
        const innerZip = zipSync({
            "page.md": strToU8("# From Nested Zip"),
        });

        const extractDir = await createAndExtractZip("nested-zip", {
            "index.html": strToU8("<html></html>"),
            "nested.zip": innerZip,
        });

        await normalizeNotionExportDirectory(extractDir);

        // Nested zip should be extracted and removed
        expect(existsSync(joinPath(extractDir, "index.html"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "page.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "nested.zip"))).toBe(false);
    });

    test("extracts Notion multi-part exports (Part-N.zip files)", async () => {
        // Create Part-1.zip
        const part1 = zipSync({
            "Export-abc123/Page1.md": strToU8("# Page 1"),
        });

        // Create Part-2.zip with index.html
        const part2 = zipSync({
            "Export-abc123/index.html": strToU8("<html></html>"),
            "Export-abc123/Page2.md": strToU8("# Page 2"),
        });

        const extractDir = await createAndExtractZip("multi-part", {
            "Export-abc123-Part-1.zip": part1,
            "Export-abc123-Part-2.zip": part2,
        });

        await normalizeNotionExportDirectory(extractDir);

        // Both parts should be merged and Export-xxx flattened
        expect(existsSync(joinPath(extractDir, "index.html"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Page1.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Page2.md"))).toBe(true);
        // Nested zips should be removed
        expect(existsSync(joinPath(extractDir, "Export-abc123-Part-1.zip"))).toBe(false);
        expect(existsSync(joinPath(extractDir, "Export-abc123-Part-2.zip"))).toBe(false);
        // Export-xxx directory should be flattened
        expect(existsSync(joinPath(extractDir, "Export-abc123"))).toBe(false);
    });

    test("handles typical Notion export structure (outer zip with inner Part.zip)", async () => {
        // This simulates what Notion produces: an outer zip containing Part-N.zip files,
        // where each Part-N.zip contains files in an Export-xxx/ directory
        const innerZip = zipSync({
            "Export-abc123/index.html": strToU8("<html></html>"),
            "Export-abc123/Page.md": strToU8("# Page"),
        });

        const extractDir = await createAndExtractZip("typical-notion", {
            "Export-abc123-Part-1.zip": innerZip,
        });

        await normalizeNotionExportDirectory(extractDir);

        // Files should be at root level
        expect(existsSync(joinPath(extractDir, "index.html"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Page.md"))).toBe(true);
    });

    test("preserves file content after normalization", async () => {
        const pageContent = "# My Important Page\n\nWith some content.";

        const innerZip = zipSync({
            "Export-abc123/page.md": strToU8(pageContent),
        });

        const extractDir = await createAndExtractZip("content-check", {
            "Export-abc123-Part-1.zip": innerZip,
        });

        await normalizeNotionExportDirectory(extractDir);

        // File content should be preserved
        const content = readFileSync(joinPath(extractDir, "page.md"), "utf8");
        expect(content).toBe(pageContent);
    });

    test("handles multiple Export-xxx directories from multi-part exports", async () => {
        // When multi-part exports are extracted, each part may have its own Export-xxx
        // directory (though typically they share the same name)
        const part1 = zipSync({
            "Export-abc123/Page1.md": strToU8("# Page 1"),
        });

        const part2 = zipSync({
            "Export-def456/Page2.md": strToU8("# Page 2"),
        });

        const extractDir = await createAndExtractZip("multi-export-dirs", {
            "Part-1.zip": part1,
            "Part-2.zip": part2,
        });

        await normalizeNotionExportDirectory(extractDir);

        // Both Export directories should be flattened
        expect(existsSync(joinPath(extractDir, "Page1.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Page2.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Export-abc123"))).toBe(false);
        expect(existsSync(joinPath(extractDir, "Export-def456"))).toBe(false);
    });

    test("only extracts .zip files, not other extensions", async () => {
        const extractDir = await createAndExtractZip("non-zip", {
            "data.tar.gz": strToU8("not a real tar.gz"),
            "archive.rar": strToU8("not a real rar"),
            "page.md": strToU8("# Page"),
        });

        await normalizeNotionExportDirectory(extractDir);

        // Non-zip files should remain unchanged
        expect(existsSync(joinPath(extractDir, "data.tar.gz"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "archive.rar"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "page.md"))).toBe(true);
    });

    test("only flattens directories starting with Export-, not others", async () => {
        const extractDir = await createAndExtractZip("other-dirs", {
            "Export-abc123/page1.md": strToU8("# Page 1"),
            "OtherDir/page2.md": strToU8("# Page 2"),
            "export-lowercase/page3.md": strToU8("# Page 3"),
        });

        await normalizeNotionExportDirectory(extractDir);

        // Only Export-xxx should be flattened (case-sensitive)
        expect(existsSync(joinPath(extractDir, "page1.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "Export-abc123"))).toBe(false);
        // Other directories should remain
        expect(existsSync(joinPath(extractDir, "OtherDir/page2.md"))).toBe(true);
        expect(existsSync(joinPath(extractDir, "export-lowercase/page3.md"))).toBe(true);
    });
});
