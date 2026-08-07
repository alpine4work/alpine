import {zipSync} from "fflate";
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "fs";
import {join as joinPath} from "path";

import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {
    ExportedNotionDocument,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {InternalError} from "~/shared/error/error.open_source.js";

// NOTE: This test does NOT use fake timers because yauzl uses setImmediate
// internally which would be blocked by jest's fake timers.

describe("unzipToDisk", () => {
    const testDirectory = joinPath(process.env.TEST_TMPDIR ?? "/tmp", "unzip_to_disk_test");
    const zipFilePath = joinPath(testDirectory, "test.zip");
    const outputDirectory = joinPath(testDirectory, "output");

    beforeEach(() => {
        // Clean up any previous test files
        if (existsSync(testDirectory)) {
            rmSync(testDirectory, {recursive: true});
        }
        mkdirSync(testDirectory, {recursive: true});
        mkdirSync(outputDirectory, {recursive: true});
    });

    afterEach(() => {
        // Clean up test files
        if (existsSync(testDirectory)) {
            rmSync(testDirectory, {recursive: true});
        }
    });

    function writeTestZip(data: Uint8Array): void {
        writeFileSync(zipFilePath, data);
    }

    function listFilesRecursively(directory: string, prefix = ""): Array<string> {
        const results: Array<string> = [];
        const entries = readdirSync(directory, {withFileTypes: true});
        for (const entry of entries) {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                results.push(
                    ...listFilesRecursively(joinPath(directory, entry.name), relativePath),
                );
            } else {
                results.push(relativePath);
            }
        }
        return results.sort();
    }

    test("extracts a simple zip file", async () => {
        const doc = new ExportedNotionDocument("Test Document", "Hello world!");
        const zipData = createTestNotionImportZip([doc]);

        writeTestZip(zipData);

        await unzipToDisk(zipFilePath, outputDirectory);

        // Should have extracted the nested zip structure
        const files = listFilesRecursively(outputDirectory);
        expect(files.length).toBeGreaterThan(0);

        // Should contain a Part-1.zip (the nested archive)
        const hasNestedZip = files.some(f => f.endsWith(".zip"));
        expect(hasNestedZip).toBe(true);
    });

    test("extracts nested directories", async () => {
        const childDoc = new ExportedNotionDocument("Child Page", "Child content");
        const parentDoc = new ExportedNotionDocument("Parent Page", "Parent content", [childDoc]);
        const zipData = createTestNotionImportZip([parentDoc], {createFoldersForSubpages: true});

        writeTestZip(zipData);

        await unzipToDisk(zipFilePath, outputDirectory);

        const files = listFilesRecursively(outputDirectory);
        expect(files.length).toBeGreaterThan(0);
    });

    test("extracts real fixture file", async () => {
        const runfiles = process.env.RUNFILES;
        if (!runfiles) {
            throw new InternalError("RUNFILES not set");
        }

        const fixturePath = joinPath(
            runfiles,
            "cyberworlds",
            "server/importer/notion/test_fixtures/Workspace-Flat.zip",
        );

        // Copy fixture to test directory
        const fixtureData = new Uint8Array(readFileSync(fixturePath));
        writeFileSync(zipFilePath, fixtureData);

        await unzipToDisk(zipFilePath, outputDirectory);

        const files = listFilesRecursively(outputDirectory);
        expect(files.length).toBeGreaterThan(0);

        // Should contain the nested Part-1.zip
        const hasNestedZip = files.some(f => f.includes("Part-1.zip"));
        expect(hasNestedZip).toBe(true);
    });

    test("handles unicode filenames", async () => {
        const doc = new ExportedNotionDocument("Café résumé 日本語", "Content with unicode");
        const zipData = createTestNotionImportZip([doc]);

        writeTestZip(zipData);

        await unzipToDisk(zipFilePath, outputDirectory);

        const files = listFilesRecursively(outputDirectory);
        expect(files.length).toBeGreaterThan(0);
    });

    test("handles empty zip file", async () => {
        const emptyZip = zipSync({});

        writeTestZip(emptyZip);

        await unzipToDisk(zipFilePath, outputDirectory);

        const files = listFilesRecursively(outputDirectory);
        expect(files).toEqual([]);
    });

    test("rejects invalid zip file", async () => {
        writeFileSync(zipFilePath, "not a zip file");

        await expect(unzipToDisk(zipFilePath, outputDirectory)).rejects.toThrow();
    });

    test("rejects non-existent file", async () => {
        const nonExistentPath = joinPath(testDirectory, "does-not-exist.zip");

        await expect(unzipToDisk(nonExistentPath, outputDirectory)).rejects.toThrow();
    });

    test("rejects absolute path escape", async () => {
        const maliciousZip = zipSync({"/etc/passwd": new TextEncoder().encode("root:x:0:0")});

        writeTestZip(maliciousZip);

        await expect(unzipToDisk(zipFilePath, outputDirectory)).rejects.toThrow(
            "Failed to unzip zip file",
        );
    });

    test("rejects relative path traversal with ../", async () => {
        const maliciousZip = zipSync({
            "../../etc/passwd": new TextEncoder().encode("root:x:0:0"),
        });

        writeTestZip(maliciousZip);

        await expect(unzipToDisk(zipFilePath, outputDirectory)).rejects.toThrow(
            "Failed to unzip zip file",
        );
    });

    test("rejects sneaky path traversal with nested ../", async () => {
        const maliciousZip = zipSync({
            "legitimate/../../outside.txt": new TextEncoder().encode("escaped"),
        });

        writeTestZip(maliciousZip);

        await expect(unzipToDisk(zipFilePath, outputDirectory)).rejects.toThrow(
            "Failed to unzip zip file",
        );
    });

    test("allows deeply nested paths that stay within directory", async () => {
        const safeZip = zipSync({
            "a/b/c/d/file.txt": new TextEncoder().encode("safe content"),
        });

        writeTestZip(safeZip);

        await unzipToDisk(zipFilePath, outputDirectory);

        const files = listFilesRecursively(outputDirectory);
        expect(files).toEqual(["a/b/c/d/file.txt"]);
    });
});
