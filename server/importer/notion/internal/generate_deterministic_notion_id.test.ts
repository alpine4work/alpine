import {
    generateDeterministicNotionFileIdSync,
    generateDeterministicNotionIdSync,
} from "~/server/importer/notion/internal/generate_deterministic_notion_id.js";
import {getChronologicalIdTime} from "~/shared/id/chronological_id.open_source.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

describe("generateDeterministicNotionIdSync", () => {
    const spaceId1 = "space1" as SpaceId;
    const spaceId2 = "space2" as SpaceId;
    const workspaceId1 = "workspace-uuid-1";
    const workspaceId2 = "workspace-uuid-2";
    const notionId1 = "abc12345678901234567890abcdef123";
    const notionId2 = "def12345678901234567890abcdef456";

    describe("DocumentId generation", () => {
        test("returns consistent ID for same inputs", () => {
            const id1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const id2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );

            expect(id1).toBe(id2);
        });

        test("different space IDs produce different document IDs", () => {
            const id1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const id2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId2,
                workspaceId1,
                notionId1,
            );

            expect(id1).not.toBe(id2);
        });

        test("different workspace IDs produce different document IDs", () => {
            const id1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const id2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId2,
                notionId1,
            );

            expect(id1).not.toBe(id2);
        });

        test("different notion IDs produce different document IDs", () => {
            const id1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const id2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId2,
            );

            expect(id1).not.toBe(id2);
        });

        test("special notion IDs for teamspace roots are unique per teamspace", () => {
            const rootId1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                "teamspace-root:ts1",
            );
            const rootId2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                "teamspace-root:ts2",
            );

            expect(rootId1).not.toBe(rootId2);
        });

        test("special notion IDs for CSV databases are unique per database", () => {
            const csvId1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                `csv-database:${notionId1}`,
            );
            const csvId2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                `csv-database:${notionId2}`,
            );

            expect(csvId1).not.toBe(csvId2);
        });

        test("regular notion ID and teamspace-root ID are different", () => {
            const regularId = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const rootId = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                `teamspace-root:${notionId1}`,
            );

            expect(regularId).not.toBe(rootId);
        });

        test("returns a valid document ID format", () => {
            const id = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );

            // Document IDs should be non-empty strings
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
        });

        test("handles empty workspace ID", () => {
            // Edge case: when no index.html is found, workspace ID might be empty
            const id1 = generateDeterministicNotionIdSync<DocumentId>(spaceId1, "", notionId1);
            const id2 = generateDeterministicNotionIdSync<DocumentId>(spaceId1, "", notionId2);

            expect(id1).not.toBe(id2);
        });

        test("same workspace imported into different spaces has different IDs", () => {
            // This is the key property: importing the same Notion workspace into different
            // Alpine spaces should produce different document IDs to avoid cross-space
            // collisions
            const idInSpace1 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const idInSpace2 = generateDeterministicNotionIdSync<DocumentId>(
                spaceId2,
                workspaceId1,
                notionId1,
            );

            expect(idInSpace1).not.toBe(idInSpace2);
        });

        test("same workspace imported into same space multiple times has same IDs", () => {
            // This is the idempotency property: re-importing should produce the same document
            // IDs for the same documents
            const firstImport = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );
            const secondImport = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );

            expect(firstImport).toBe(secondImport);
        });
    });

    describe("FileId generation with generateDeterministicNotionFileIdSync", () => {
        const filePath1 = "attachments/image1.png";
        const filePath2 = "attachments/image2.jpg";
        const importTime = Date.now();

        test("returns consistent ID for same inputs including time", () => {
            const id1 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );
            const id2 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );

            expect(id1).toBe(id2);
        });

        test("different file paths produce different file IDs", () => {
            const id1 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );
            const id2 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath2}`,
                importTime,
            );

            expect(id1).not.toBe(id2);
        });

        test("same file in different workspaces produces different IDs", () => {
            const id1 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );
            const id2 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId2,
                `file:${filePath1}`,
                importTime,
            );

            expect(id1).not.toBe(id2);
        });

        test("same file imported to different spaces produces different IDs", () => {
            const id1 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );
            const id2 = generateDeterministicNotionFileIdSync(
                spaceId2,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );

            expect(id1).not.toBe(id2);
        });

        test("file ID is different from document ID for same unique string", () => {
            // Even though both use the same input string, the prefix differentiates them
            const fileId = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${notionId1}`,
                importTime,
            );
            const docId = generateDeterministicNotionIdSync<DocumentId>(
                spaceId1,
                workspaceId1,
                notionId1,
            );

            // They should be different because the input strings are different
            expect(fileId).not.toBe(docId);
        });

        test("encodes the time in the file ID", () => {
            const id = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                importTime,
            );

            expect(getChronologicalIdTime(id)).toBe(importTime);
        });

        test("file IDs with earlier times sort before those with later times", () => {
            const earlierTime = 1000000000000;
            const laterTime = 2000000000000;

            const earlierId = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                earlierTime,
            );
            const laterId = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                laterTime,
            );

            expect(earlierId < laterId).toBe(true);
        });

        test("different times with same inputs produce different IDs", () => {
            const time1 = 1000000000000;
            const time2 = 1000000000001;

            const id1 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                time1,
            );
            const id2 = generateDeterministicNotionFileIdSync(
                spaceId1,
                workspaceId1,
                `file:${filePath1}`,
                time2,
            );

            expect(id1).not.toBe(id2);
        });
    });
});
