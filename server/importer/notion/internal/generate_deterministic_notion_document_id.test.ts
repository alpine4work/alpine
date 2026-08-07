import {generateDeterministicNotionDocumentIdSync} from "~/server/importer/notion/internal/generate_deterministic_notion_document_id.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

describe("generateDeterministicNotionDocumentIdSync", () => {
    const spaceId1 = "space1" as SpaceId;
    const spaceId2 = "space2" as SpaceId;
    const workspaceId1 = "workspace-uuid-1";
    const workspaceId2 = "workspace-uuid-2";
    const notionId1 = "abc12345678901234567890abcdef123";
    const notionId2 = "def12345678901234567890abcdef456";

    test("returns consistent ID for same inputs", () => {
        const id1 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);
        const id2 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);

        expect(id1).toBe(id2);
    });

    test("different space IDs produce different document IDs", () => {
        const id1 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);
        const id2 = generateDeterministicNotionDocumentIdSync(spaceId2, workspaceId1, notionId1);

        expect(id1).not.toBe(id2);
    });

    test("different workspace IDs produce different document IDs", () => {
        const id1 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);
        const id2 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId2, notionId1);

        expect(id1).not.toBe(id2);
    });

    test("different notion IDs produce different document IDs", () => {
        const id1 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);
        const id2 = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId2);

        expect(id1).not.toBe(id2);
    });

    test("special notion IDs for teamspace roots are unique per teamspace", () => {
        const rootId1 = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            "teamspace-root:ts1",
        );
        const rootId2 = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            "teamspace-root:ts2",
        );

        expect(rootId1).not.toBe(rootId2);
    });

    test("special notion IDs for CSV databases are unique per database", () => {
        const csvId1 = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            `csv-database:${notionId1}`,
        );
        const csvId2 = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            `csv-database:${notionId2}`,
        );

        expect(csvId1).not.toBe(csvId2);
    });

    test("regular notion ID and teamspace-root ID are different", () => {
        const regularId = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            notionId1,
        );
        const rootId = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            `teamspace-root:${notionId1}`,
        );

        expect(regularId).not.toBe(rootId);
    });

    test("returns a valid document ID format", () => {
        const id = generateDeterministicNotionDocumentIdSync(spaceId1, workspaceId1, notionId1);

        // Document IDs should be non-empty strings
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
    });

    test("handles empty workspace ID", () => {
        // Edge case: when no index.html is found, workspace ID might be empty
        const id1 = generateDeterministicNotionDocumentIdSync(spaceId1, "", notionId1);
        const id2 = generateDeterministicNotionDocumentIdSync(spaceId1, "", notionId2);

        expect(id1).not.toBe(id2);
    });

    test("same workspace imported into different spaces has different IDs", () => {
        // This is the key property: importing the same Notion workspace into different
        // Alpine spaces should produce different document IDs to avoid cross-space
        // collisions
        const idInSpace1 = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            notionId1,
        );
        const idInSpace2 = generateDeterministicNotionDocumentIdSync(
            spaceId2,
            workspaceId1,
            notionId1,
        );

        expect(idInSpace1).not.toBe(idInSpace2);
    });

    test("same workspace imported into same space multiple times has same IDs", () => {
        // This is the idempotency property: re-importing should produce the same document
        // IDs for the same documents
        const firstImport = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            notionId1,
        );
        const secondImport = generateDeterministicNotionDocumentIdSync(
            spaceId1,
            workspaceId1,
            notionId1,
        );

        expect(firstImport).toBe(secondImport);
    });
});
