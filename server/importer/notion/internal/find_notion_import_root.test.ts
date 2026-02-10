/* eslint-disable cyberworlds/string-quotes -- JSON strings need straight quotes */
import {strToU8, zipSync} from "fflate";
import {readFileSync} from "fs";
import {join} from "path";

import {findNotionImportRoot} from "~/server/importer/notion/internal/find_notion_import_root.js";
import {
    ExportedNotionDocument,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";

function readFixture(name: string): Uint8Array {
    const runfiles = process.env.RUNFILES;
    const base = runfiles ? join(runfiles, "cyberworlds") : ".";
    return new Uint8Array(readFileSync(join(base, "server/importer/notion/test_fixtures", name)));
}

describe("findNotionImportRoot", () => {
    describe("valid Notion exports", () => {
        test("finds index.html in double-nested Notion export (flat)", () => {
            const doc = new ExportedNotionDocument("Test Page", "Some content");
            const zip = createTestNotionImportZip([doc]);

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });

        test("finds index.html in double-nested Notion export (nested)", () => {
            const child = new ExportedNotionDocument("Child", "child content");
            const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
            const zip = createTestNotionImportZip([parent], {createFoldersForSubpages: true});

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });

        test("returns all files at the root level", () => {
            const doc = new ExportedNotionDocument("My Page", "Hello world");
            const zip = createTestNotionImportZip([doc]);

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const mdFiles = Object.keys(result!).filter(k => k.endsWith(".md"));
            expect(mdFiles.length).toBeGreaterThan(0);
        });

        test("real fixture: JJ-Test-Flat.zip", () => {
            const zip = readFixture("JJ-Test-Flat.zip");

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });

        test("real fixture: JJ-Test-Nested.zip", () => {
            const zip = readFixture("JJ-Test-Nested.zip");

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });

        test("real fixture: Workspace-Flat.zip (with teamspaces)", () => {
            const zip = readFixture("Workspace-Flat.zip");

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });

        test("real fixture: Workspace-Nested.zip (with teamspaces)", () => {
            const zip = readFixture("Workspace-Nested.zip");

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            const indexKey = Object.keys(result!).find(
                k => k === "index.html" || k.endsWith("/index.html"),
            );
            expect(indexKey).toBeDefined();
        });
    });

    describe("invalid or non-Notion zips", () => {
        test("returns null for empty zip", () => {
            const zip = zipSync({});

            const result = findNotionImportRoot(zip);

            expect(result).toBeNull();
        });

        test("returns null for zip without index.html", () => {
            const zip = zipSync({
                "readme.txt": strToU8("This is not a Notion export"),
                "data.json": strToU8('{"key": "value"}'),
            });

            const result = findNotionImportRoot(zip);

            expect(result).toBeNull();
        });

        test("returns null for nested zip without index.html", () => {
            const innerZip = zipSync({
                "file1.md": strToU8("# Hello"),
                "file2.md": strToU8("# World"),
            });
            const outerZip = zipSync({
                "inner.zip": innerZip,
            });

            const result = findNotionImportRoot(outerZip);

            expect(result).toBeNull();
        });
    });

    describe("nested zip handling", () => {
        test("finds index.html inside single-nested zip and strips root path", () => {
            const innerFiles = {
                "Export-123/index.html": strToU8("<html><body>index</body></html>"),
                "Export-123/Page abc123.md": strToU8("# Page"),
            };
            const innerZip = zipSync(innerFiles);
            const outerZip = zipSync({
                "Export-123-Part-1.zip": innerZip,
            });

            const result = findNotionImportRoot(outerZip);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html><body>index</body></html>"),
                "Page abc123.md": strToU8("# Page"),
            });
        });

        test("finds index.html inside double-nested zip and strips root path", () => {
            const deepFiles = {
                "Export-456/index.html": strToU8("<html><body>deep index</body></html>"),
                "Export-456/Doc def456.md": strToU8("# Doc"),
            };
            const middleZip = zipSync(deepFiles);
            const innerZip = zipSync({
                "Export-456-Part-1.zip": middleZip,
            });
            const outerZip = zipSync({
                "wrapper.zip": innerZip,
            });

            const result = findNotionImportRoot(outerZip);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html><body>deep index</body></html>"),
                "Doc def456.md": strToU8("# Doc"),
            });
        });

        test("stops at first level containing index.html and strips root path", () => {
            const deeperFiles = {
                "deeper/index.html": strToU8("<html>deeper</html>"),
            };
            const deeperZip = zipSync(deeperFiles);

            const innerFiles = {
                "Export/index.html": strToU8("<html>inner</html>"),
                "Export/nested.zip": deeperZip,
            };
            const innerZip = zipSync(innerFiles);
            const outerZip = zipSync({
                "Export-Part-1.zip": innerZip,
            });

            const result = findNotionImportRoot(outerZip);

            // Should find the first level with index.html, not recurse deeper
            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html>inner</html>"),
                "nested.zip": deeperZip,
            });
        });

        test("searches multiple zip files at same level and strips root path", () => {
            const emptyZip = zipSync({
                "empty.txt": strToU8("nothing here"),
            });
            const validFiles = {
                "Export/index.html": strToU8("<html>found</html>"),
            };
            const validZip = zipSync(validFiles);

            const outerZip = zipSync({
                "first.zip": emptyZip,
                "second.zip": validZip,
            });

            const result = findNotionImportRoot(outerZip);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html>found</html>"),
            });
        });
    });

    describe("index.html detection", () => {
        test("finds index.html at root level", () => {
            const files = {
                "index.html": strToU8("<html>root</html>"),
                "page.md": strToU8("# Page"),
            };
            const zip = zipSync(files);

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            expect(result).toEqual(files);
        });

        test("finds index.html in subdirectory and strips root path", () => {
            const files = {
                "Export-abc/index.html": strToU8("<html>in subdir</html>"),
                "Export-abc/page.md": strToU8("# Page"),
            };
            const zip = zipSync(files);

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html>in subdir</html>"),
                "page.md": strToU8("# Page"),
            });
        });

        test("finds index.html in deeply nested directory and strips root path", () => {
            const files = {
                "a/b/c/index.html": strToU8("<html>deep</html>"),
                "a/b/c/doc.md": strToU8("# Doc"),
            };
            const zip = zipSync(files);

            const result = findNotionImportRoot(zip);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                "index.html": strToU8("<html>deep</html>"),
                "doc.md": strToU8("# Doc"),
            });
        });
    });
});
