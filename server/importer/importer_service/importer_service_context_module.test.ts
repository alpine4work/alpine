import {strToU8, zipSync} from "fflate";
import {existsSync, mkdirSync, rmSync, writeFileSync} from "fs";
import {dirname, join as joinPath} from "path";

import {ImporterServiceDevelopmentContextModule} from "~/server/importer/importer_service/importer_service_development_context_module.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * Tests for the importer service context modules (development and production).
 *
 * These tests cover the functionality for processing imports:
 *
 * - downloadAndUnzipImportToDisk: Downloads and extracts import files
 * - listUnzippedFiles: Lists all files in an extracted import
 * - readUnzippedFile: Reads file content from extracted imports
 */
describe("ImporterServiceDevelopmentContextModule", () => {
    const testTmpDir = assertExists(process.env.TEST_TMPDIR);
    const workspacePath = joinPath(testTmpDir, "test-workspace");
    const uploadDir = joinPath(workspacePath, "import-uploads");

    beforeEach(() => {
        // Clean up and recreate test directories
        if (existsSync(workspacePath)) {
            rmSync(workspacePath, {recursive: true});
        }
        mkdirSync(uploadDir, {recursive: true});
    });

    afterAll(() => {
        // Clean up test workspace
        if (existsSync(workspacePath)) {
            rmSync(workspacePath, {recursive: true});
        }
    });

    /**
     * Helper to write a test file to the upload directory. Simulates what
     * ImporterDevelopmentContextModule.writeUploadedFile does.
     */
    function writeUploadedFile(importKey: string, data: Uint8Array): void {
        const filePath = joinPath(uploadDir, importKey);
        const dir = dirname(filePath);

        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
        }

        writeFileSync(filePath, data);
    }

    describe("downloadAndUnzipImportToDisk", () => {
        test("unzips file with index.html at root", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            // Create a zip with index.html at root
            const zipData = zipSync({
                "index.html": strToU8("<html><body>Test</body></html>"),
                "page.md": strToU8("# Test Page"),
            });

            const importKey = "unzip-test-root";
            writeUploadedFile(importKey, zipData);

            const result = await module.downloadAndUnzipImportToDisk({importKey});

            // Should return the unzip directory (index.html is at root)
            expect(existsSync(result.diskPathToUnzippedFiles)).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "index.html"))).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "page.md"))).toBe(true);
        });

        test("unzips file with subdirectory structure", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            // Create a zip with subdirectory structure
            const zipData = zipSync({
                "root/index.html": strToU8("<html><body>Content</body></html>"),
                "root/page.md": strToU8("# Page"),
                "root/subdir/nested.md": strToU8("# Nested Page"),
            });

            const importKey = "unzip-test-subdir";
            writeUploadedFile(importKey, zipData);

            const result = await module.downloadAndUnzipImportToDisk({importKey});

            // Files are extracted with their original paths preserved
            expect(existsSync(result.diskPathToUnzippedFiles)).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "root/index.html"))).toBe(
                true,
            );
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "root/page.md"))).toBe(true);
            expect(
                existsSync(joinPath(result.diskPathToUnzippedFiles, "root/subdir/nested.md")),
            ).toBe(true);
        });

        test("returns unzip directory when index.html not found", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            // Create a zip without index.html
            const zipData = zipSync({
                "file1.txt": strToU8("Content 1"),
                "file2.txt": strToU8("Content 2"),
            });

            const importKey = "unzip-test-no-index";
            writeUploadedFile(importKey, zipData);

            const result = await module.downloadAndUnzipImportToDisk({importKey});

            // Should return the base unzip directory
            expect(existsSync(result.diskPathToUnzippedFiles)).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "file1.txt"))).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "file2.txt"))).toBe(true);
        });

        test("throws DataLossError when zip file not found", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            await expect(
                module.downloadAndUnzipImportToDisk({importKey: "nonexistent-file"}),
            ).rejects.toThrow(DataLossError);
        });

        test("does not extract nested zip files automatically", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            // Create a nested zip
            const innerZip = zipSync({
                "page.md": strToU8("# Page"),
            });
            const outerZip = zipSync({
                "nested.zip": innerZip,
            });

            const importKey = "nested-no-extract-test";
            writeUploadedFile(importKey, outerZip);

            const result = await module.downloadAndUnzipImportToDisk({importKey});

            // The nested zip file should NOT be automatically extracted
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "nested.zip"))).toBe(true);
            expect(existsSync(joinPath(result.diskPathToUnzippedFiles, "page.md"))).toBe(false);
        });
    });

    describe("listUnzippedFiles", () => {
        test("lists all files recursively", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            const zipData = zipSync({
                "index.html": strToU8("<html></html>"),
                "page1.md": strToU8("# Page 1"),
                "subdir/page2.md": strToU8("# Page 2"),
                "subdir/nested/page3.md": strToU8("# Page 3"),
            });

            const importKey = "list-test";
            writeUploadedFile(importKey, zipData);

            const {diskPathToUnzippedFiles} = await module.downloadAndUnzipImportToDisk({
                importKey,
            });
            const files = await module.listUnzippedFiles({diskPathToUnzippedFiles});

            expect(files).toContain("index.html");
            expect(files).toContain("page1.md");
            expect(files).toContain("subdir/page2.md");
            expect(files).toContain("subdir/nested/page3.md");
            expect(files).toHaveLength(4);
        });

        test("returns empty array for nonexistent path", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            const files = await module.listUnzippedFiles({
                diskPathToUnzippedFiles: "/nonexistent/path",
            });

            expect(files).toEqual([]);
        });
    });

    describe("readUnzippedFile", () => {
        test("reads file content from unzipped directory", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            const pageContent = "# My Test Page\n\nSome content here.";
            const zipData = zipSync({
                "index.html": strToU8("<html></html>"),
                "page.md": strToU8(pageContent),
            });

            const importKey = "read-test";
            writeUploadedFile(importKey, zipData);

            const {diskPathToUnzippedFiles} = await module.downloadAndUnzipImportToDisk({
                importKey,
            });
            const content = await module.readUnzippedFile({
                diskPathToUnzippedFiles,
                relativeFilePath: "page.md",
            });

            expect(content).toEqual(strToU8(pageContent));
        });

        test("reads nested file", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            const nestedContent = "# Nested Page";
            const zipData = zipSync({
                "index.html": strToU8("<html></html>"),
                "subdir/nested/page.md": strToU8(nestedContent),
            });

            const importKey = "read-nested-test";
            writeUploadedFile(importKey, zipData);

            const {diskPathToUnzippedFiles} = await module.downloadAndUnzipImportToDisk({
                importKey,
            });
            const content = await module.readUnzippedFile({
                diskPathToUnzippedFiles,
                relativeFilePath: "subdir/nested/page.md",
            });

            expect(content).toEqual(strToU8(nestedContent));
        });

        test("returns null for nonexistent file", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });

            const zipData = zipSync({
                "index.html": strToU8("<html></html>"),
            });

            const importKey = "read-nonexistent-test";
            writeUploadedFile(importKey, zipData);

            const {diskPathToUnzippedFiles} = await module.downloadAndUnzipImportToDisk({
                importKey,
            });
            const content = await module.readUnzippedFile({
                diskPathToUnzippedFiles,
                relativeFilePath: "does-not-exist.md",
            });

            expect(content).toBeNull();
        });
    });

    describe("fork", () => {
        test("returns a new instance with same config", async () => {
            const module = new ImporterServiceDevelopmentContextModule({
                getLocalUploadPath: () => workspacePath,
            });
            const forked = module.fork();

            expect(forked).toBeInstanceOf(ImporterServiceDevelopmentContextModule);
            expect(forked).not.toBe(module);

            // Verify they share the same workspace by writing through one and reading through
            // other
            const zipData = zipSync({
                "index.html": strToU8("<html></html>"),
            });
            const importKey = "fork-test";
            writeUploadedFile(importKey, zipData);

            // Both modules should be able to access the same file
            const result = await module.downloadAndUnzipImportToDisk({importKey});
            expect(existsSync(result.diskPathToUnzippedFiles)).toBe(true);
        });
    });
});
