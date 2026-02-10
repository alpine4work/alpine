/* eslint-disable cyberworlds/string-quotes -- Test descriptions may contain apostrophes */
import {strToU8} from "fflate";
import {readFileSync} from "fs";
import {join} from "path";

import {findNotionImportRoot} from "~/server/importer/notion/internal/find_notion_import_root.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {
    ExportedNotionDocument,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {InternalError} from "~/shared/error/error.js";

function readFixture(name: string): Uint8Array {
    const runfiles = process.env.RUNFILES;
    const base = runfiles ? join(runfiles, "cyberworlds") : ".";
    return new Uint8Array(readFileSync(join(base, "server/importer/notion/test_fixtures", name)));
}

/**
 * Helper to get raw files from a test zip for use with getNotionImportMetadata.
 */
function getRawFiles(zip: Uint8Array): Record<string, Uint8Array> {
    const result = findNotionImportRoot(zip);
    if (!result) throw new InternalError("Failed to find Notion import root");
    return result;
}

describe("getNotionImportMetadata", () => {
    describe("workspace name extraction", () => {
        test("extracts workspace name from generated export", () => {
            const doc = new ExportedNotionDocument("Test Page", "content");
            const zip = createTestNotionImportZip([doc], {workspaceName: "My Workspace"});
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("My Workspace");
        });

        test("extracts workspace name with special characters", () => {
            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc], {
                workspaceName: "Josh's & Mary's Workspace",
            });
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Josh's & Mary's Workspace");
        });

        test("extracts workspace name with unicode characters", () => {
            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc], {
                workspaceName: "Workspace ’s Space",
            });
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Workspace ’s Space");
        });
    });

    describe("exports without teamspaces", () => {
        test("returns implicit teamspace for export without teamspaces", () => {
            const doc = new ExportedNotionDocument("Home", "welcome");
            const zip = createTestNotionImportZip([doc], {workspaceName: "My Workspace"});
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            // When there are no teamspaces, the workspace itself is used as an implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("My Workspace");
        });

        test("returns implicit teamspace for multi-page export without teamspaces", () => {
            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const page3 = new ExportedNotionDocument("Page 3", "");
            const zip = createTestNotionImportZip([page1, page2, page3], {workspaceName: "Multi"});
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Multi");
        });

        test("returns implicit teamspace for nested page hierarchy without teamspaces", () => {
            const grandchild = new ExportedNotionDocument("Grandchild", "");
            const child = new ExportedNotionDocument("Child", "", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const zip = createTestNotionImportZip([parent], {workspaceName: "Nested"});
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Nested");
        });
    });

    describe("exports with teamspaces", () => {
        test("detects single teamspace", () => {
            const page = new ExportedNotionDocument("Home", "welcome");
            const teamspace = new ExportedNotionTeamspace("My Team", [page]);
            const zip = createTestNotionImportZip([teamspace]);
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("My Team");
            expect([...metadata!.teamspaceNameById.keys()][0]).toBeDefined();
        });

        test("detects multiple teamspaces", () => {
            const page1 = new ExportedNotionDocument("Private Page", "");
            const page2 = new ExportedNotionDocument("Public Page", "");
            const privateTs = new ExportedNotionTeamspace("Private & Shared", [page1]);
            const publicTs = new ExportedNotionTeamspace("Public Space", [page2]);
            const zip = createTestNotionImportZip([privateTs, publicTs]);
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(2);

            const names = [...metadata!.teamspaceNameById.values()].sort();
            expect(names).toEqual(["Private & Shared", "Public Space"]);
        });

        test("teamspaces have unique IDs (enforced by Map)", () => {
            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const ts1 = new ExportedNotionTeamspace("Team A", [page1]);
            const ts2 = new ExportedNotionTeamspace("Team B", [page2]);
            const zip = createTestNotionImportZip([ts1, ts2]);
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            // Map keys are inherently unique, so size == number of unique IDs
            expect(metadata!.teamspaceNameById.size).toBe(2);
        });

        test("teamspace names with special characters are preserved", () => {
            const page = new ExportedNotionDocument("Page", "");
            const teamspace = new ExportedNotionTeamspace("Josh's Space HQ", [page]);
            const zip = createTestNotionImportZip([teamspace]);
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("Josh's Space HQ");
        });

        test("teamspace with nested pages", () => {
            const child = new ExportedNotionDocument("Child", "");
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const teamspace = new ExportedNotionTeamspace("My Team", [parent]);
            const zip = createTestNotionImportZip([teamspace]);
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect([...metadata!.teamspaceNameById.values()][0]).toBe("My Team");
        });
    });

    describe("invalid exports", () => {
        test("returns null for files without index.html", () => {
            const rawFiles = {
                "readme.txt": strToU8("This is not a Notion export"),
                "data.json": strToU8('{"key": "value"}'),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).toBeNull();
        });

        test("returns null for index.html without workspace name", () => {
            const rawFiles = {
                "Export/index.html": strToU8("<html><body><p>No workspace info</p></body></html>"),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).toBeNull();
        });

        test("returns null for empty files map", () => {
            const rawFiles: Record<string, Uint8Array> = {};

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).toBeNull();
        });
    });

    describe("real Notion export fixtures", () => {
        test("JJ-Test-Flat.zip - implicit teamspace from workspace", () => {
            const zip = readFixture("JJ-Test-Flat.zip");
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Export");
            // No explicit teamspaces, but workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Export");
        });

        test("JJ-Test-Nested.zip - implicit teamspace from workspace", () => {
            const zip = readFixture("JJ-Test-Nested.zip");
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Export");
            // No explicit teamspaces, but workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Export");
        });

        test("Workspace-Flat.zip - with teamspaces", () => {
            const zip = readFixture("Workspace-Flat.zip");
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Alpine Test Space");
            expect(metadata!.teamspaceNameById.size).toBeGreaterThan(0);

            // Should have "Private & Shared" (with spaces) and another teamspace
            const names = [...metadata!.teamspaceNameById.values()];
            expect(names).toContain("Private & Shared");
        });

        test("Workspace-Nested.zip - with teamspaces", () => {
            const zip = readFixture("Workspace-Nested.zip");
            const rawFiles = getRawFiles(zip);

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBeDefined();
            expect(metadata!.teamspaceNameById.size).toBeGreaterThan(0);

            // Should have "Private & Shared" and another teamspace
            const names = [...metadata!.teamspaceNameById.values()];
            expect(names).toContain("Private & Shared");
        });

        test("Workspace fixtures have consistent teamspace IDs between flat and nested", () => {
            const flatZip = readFixture("Workspace-Flat.zip");
            const nestedZip = readFixture("Workspace-Nested.zip");

            const flatMetadata = getNotionImportMetadata(getRawFiles(flatZip));
            const nestedMetadata = getNotionImportMetadata(getRawFiles(nestedZip));

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
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: Root Level Workspace</p>
                        <ul id="id::abc123">
                            <li><ul id="id::def456">
                                <a href="./Page def456.md">Page def456.md</a>
                            </ul></li>
                        </ul>
                    </body></html>
                `),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Root Level Workspace");
        });

        test("handles index.html in subdirectory", () => {
            const rawFiles = {
                "Export-123/index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: Subdirectory Workspace</p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Subdirectory Workspace");
        });

        test("handles workspace name with leading/trailing whitespace", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name:    Trimmed Name   </p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Trimmed Name");
        });

        test("handles empty workspace root (no pages)", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: Empty Workspace</p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const metadata = getNotionImportMetadata(rawFiles);

            expect(metadata).not.toBeNull();
            expect(metadata!.workspaceName).toBe("Empty Workspace");
            // Even with no pages, workspace is used as implicit teamspace
            expect(metadata!.teamspaceNameById.size).toBe(1);
            expect(metadata!.teamspaceNameById.get(metadata!.workspaceId)).toBe("Empty Workspace");
        });
    });
});
