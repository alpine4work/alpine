/* eslint-disable cyberworlds/string-quotes -- Test descriptions may contain apostrophes */
import {strToU8} from "fflate";
import {readFileSync} from "fs";
import {join} from "path";

import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {
    ExportedNotionDocument,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {
    extractTestNotionImportToDisk,
    readTestNotionImportIndexHtml,
} from "~/server/importer/notion/test_helpers/extract_test_notion_import_to_disk.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

function readFixture(name: string): Uint8Array {
    const runfiles = process.env.RUNFILES;
    const base = runfiles ? join(runfiles, "cyberworlds") : ".";
    return new Uint8Array(readFileSync(join(base, "server/importer/notion/test_fixtures", name)));
}

/**
 * Helper to extract index.html content from a test zip using disk-based
 * operations.
 */
async function getIndexHtmlFromZip(zip: Uint8Array): Promise<Uint8Array | null> {
    const {diskPath, filePaths} = await extractTestNotionImportToDisk(zip);
    return readTestNotionImportIndexHtml(diskPath, filePaths);
}

describe("getNotionImportMetadata", () => {
    describe("workspace name extraction", () => {
        test("extracts workspace name from generated export", async () => {
            const doc = new ExportedNotionDocument("Test Page", "content");
            const zip = createTestNotionImportZip([doc], {workspaceName: "My Workspace"});
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("My Workspace");
        });

        test("extracts workspace name with special characters", async () => {
            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc], {
                workspaceName: "Josh's & Mary's Workspace",
            });
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Josh's & Mary's Workspace");
        });

        test("extracts workspace name with unicode characters", async () => {
            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc], {
                workspaceName: "Workspace 's Space",
            });
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Workspace 's Space");
        });
    });

    describe("exports without teamspaces", () => {
        test("returns implicit teamspace for export without teamspaces", async () => {
            const doc = new ExportedNotionDocument("Home", "welcome");
            const zip = createTestNotionImportZip([doc], {workspaceName: "My Workspace"});
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            // When there are no teamspaces, the workspace itself is used as an implicit
            // teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("My Workspace");
        });

        test("returns implicit teamspace for multi-page export without teamspaces", async () => {
            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const page3 = new ExportedNotionDocument("Page 3", "");
            const zip = createTestNotionImportZip([page1, page2, page3], {workspaceName: "Multi"});
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Multi");
        });

        test("returns implicit teamspace for nested page hierarchy without teamspaces", async () => {
            const grandchild = new ExportedNotionDocument("Grandchild", "");
            const child = new ExportedNotionDocument("Child", "", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const zip = createTestNotionImportZip([parent], {workspaceName: "Nested"});
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Nested");
        });
    });

    describe("exports with teamspaces", () => {
        test("detects single teamspace", async () => {
            const page = new ExportedNotionDocument("Home", "welcome");
            const teamspace = new ExportedNotionTeamspace("My Team", [page]);
            const zip = createTestNotionImportZip([teamspace]);
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("My Team");
            expect([...metadata!.teamspaceNameById.keys()][0]).toBeDefined();
        });

        test("detects multiple teamspaces", async () => {
            const page1 = new ExportedNotionDocument("Private Page", "");
            const page2 = new ExportedNotionDocument("Public Page", "");
            const privateTs = new ExportedNotionTeamspace("Private & Shared", [page1]);
            const publicTs = new ExportedNotionTeamspace("Public Space", [page2]);
            const zip = createTestNotionImportZip([privateTs, publicTs]);
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(2);

            const names = [...metadata!.teamspaceNameById.values()].sort();
            expect(names).toEqual(["Private & Shared", "Public Space"]);
        });

        test("teamspaces have unique IDs (enforced by Map)", async () => {
            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const ts1 = new ExportedNotionTeamspace("Team A", [page1]);
            const ts2 = new ExportedNotionTeamspace("Team B", [page2]);
            const zip = createTestNotionImportZip([ts1, ts2]);
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            // Map keys are inherently unique, so size == number of unique IDs
            expect(metadata!.teamspaceNameById.size).toBe(2);
        });

        test("teamspace names with special characters are preserved", async () => {
            const page = new ExportedNotionDocument("Page", "");
            const teamspace = new ExportedNotionTeamspace("Josh's Space HQ", [page]);
            const zip = createTestNotionImportZip([teamspace]);
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("Josh's Space HQ");
        });

        test("teamspace with nested pages", async () => {
            const child = new ExportedNotionDocument("Child", "");
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const teamspace = new ExportedNotionTeamspace("My Team", [parent]);
            const zip = createTestNotionImportZip([teamspace]);
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("My Team");
        });
    });

    describe("invalid exports", () => {
        test("returns null when index.html is missing from zip", async () => {
            const {diskPath, filePaths} = await extractTestNotionImportToDisk(
                createTestNotionImportZip([new ExportedNotionDocument("Page", "")]),
            );

            // Simulate missing index.html by filtering it out
            const filePathsWithoutIndex = filePaths.filter(
                p => p !== "index.html" && !p.endsWith("/index.html"),
            );
            const indexHtml = await readTestNotionImportIndexHtml(diskPath, filePathsWithoutIndex);

            expect(indexHtml).toBeNull();
        });

        test("returns null for index.html without workspace name", () => {
            const indexHtml = strToU8("<html><body><p>No workspace info</p></body></html>");

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).toBeNull();
        });
    });

    describe("real Notion export fixtures", () => {
        test("JJ-Test-Flat.zip - implicit teamspace from workspace", async () => {
            const zip = readFixture("JJ-Test-Flat.zip");
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Export");
            // No explicit teamspaces, but workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Export");
        });

        test("JJ-Test-Nested.zip - implicit teamspace from workspace", async () => {
            const zip = readFixture("JJ-Test-Nested.zip");
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Export");
            // No explicit teamspaces, but workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Export");
        });

        test("Workspace-Flat.zip - with teamspaces", async () => {
            const zip = readFixture("Workspace-Flat.zip");
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Alpine Test Space");
            expect(metadata!.teamspaceNameById.size).toBeGreaterThan(0);

            // Should have "Private & Shared" (with spaces) and another teamspace
            const names = [...metadata!.teamspaceNameById.values()];
            expect(names).toContain("Private & Shared");
        });

        test("Workspace-Nested.zip - with teamspaces", async () => {
            const zip = readFixture("Workspace-Nested.zip");
            const indexHtml = assertExists(await getIndexHtmlFromZip(zip));

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBeDefined();
            expect(metadata!.teamspaceNameById.size).toBeGreaterThan(0);

            // Should have "Private & Shared" and another teamspace
            const names = [...metadata!.teamspaceNameById.values()];
            expect(names).toContain("Private & Shared");
        });

        test("Workspace fixtures have consistent teamspace IDs between flat and nested", async () => {
            const flatZip = readFixture("Workspace-Flat.zip");
            const nestedZip = readFixture("Workspace-Nested.zip");
            const flatIndexHtml = assertExists(await getIndexHtmlFromZip(flatZip));
            const nestedIndexHtml = assertExists(await getIndexHtmlFromZip(nestedZip));

            const flatMetadata = getNotionImportMetadata(flatIndexHtml);
            const nestedMetadata = getNotionImportMetadata(nestedIndexHtml);

            expect(flatMetadata).not.toBeNull();
            expect(nestedMetadata).not.toBeNull();

            // Both should have the same number of teamspaces
            expect(flatMetadata!.teamspaceNameById.size).toBe(
                nestedMetadata!.teamspaceNameById.size,
            );

            // The teamspace IDs should match (same workspace exported two ways)
            const flatIds = new Set(flatMetadata!.teamspaceNameById.keys());
            const nestedIds = new Set(nestedMetadata!.teamspaceNameById.keys());
            expect(flatIds).toEqual(nestedIds);
        });
    });

    describe("edge cases", () => {
        test("handles index.html at root level", () => {
            const indexHtml = strToU8(`
                <html><body>
                    <p>Workspace name: Root Level Workspace</p>
                    <ul id="id::abc123">
                        <li><ul id="id::def456">
                            <a href="./Page def456.md">Page def456.md</a>
                        </ul></li>
                    </ul>
                </body></html>
            `);

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Root Level Workspace");
        });

        test("handles workspace name with leading/trailing whitespace", () => {
            const indexHtml = strToU8(`
                <html><body>
                    <p>Workspace name:    Trimmed Name   </p>
                    <ul id="id::abc123"></ul>
                </body></html>
            `);

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Trimmed Name");
        });

        test("handles empty workspace root (no pages)", () => {
            const indexHtml = strToU8(`
                <html><body>
                    <p>Workspace name: Empty Workspace</p>
                    <ul id="id::abc123"></ul>
                </body></html>
            `);

            const metadata = getNotionImportMetadata(indexHtml);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Empty Workspace");
            // Even with no pages, workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Empty Workspace");
        });
    });
});
