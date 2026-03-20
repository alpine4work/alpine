/* eslint-disable cyberworlds/string-quotes -- Test descriptions may contain apostrophes */
import {readFileSync} from "fs";
import {join} from "path";

import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {
    NotionImportMappedReferencesResult,
    parseNotionImportAndMapReferences,
} from "~/server/importer/notion/internal/parse_notion_import_and_map_references.js";
import {
    ExportedNotionDatabase,
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {generateId, isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {NotionImportItem} from "~/shared/importer/notion/notion_import_item.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

/**
 * Helper to parse a Notion import zip using the test importer context. This wraps
 * parseNotionImportAndMapReferences with a TestImporterContextModule that stores
 * files in memory.
 */
async function parseNotionImportWithTestContext(
    zip: Uint8Array,
    notionImportItem: NotionImportItem,
): Promise<NotionImportMappedReferencesResult | null> {
    const importKey = notionImportItem.importKey;
    const importer = new TestImporterContextModule();
    await importer.setUploadedFile(importKey, zip);

    const {diskPathToUnzippedFiles} = await importer.downloadAndUnzipImportToDisk({importKey});
    await normalizeNotionExportDirectory(diskPathToUnzippedFiles);

    return Context.with({tracer: new TracerContextModule(testTracer)}, async ctx =>
        parseNotionImportAndMapReferences(
            {tracer: ctx.tracer, importerService: importer},
            diskPathToUnzippedFiles,
            notionImportItem,
        ),
    );
}

function createTestNotionImportItem(
    teamspaceImportOptions?: NotionImportItem["teamspaceImportOptions"],
): NotionImportItem {
    return {
        spaceId: generateId<SpaceId>(),
        workspaceName: null,
        importKey: `${generateId<SpaceId>()}/${generateId()}`,
        importZipSize: 1024,
        startedByAccountId: generateId<AccountId>(),
        createdTime: new Date(),
        updatedTime: new Date(),
        startedProcessingTime: new Date(),
        teamspaceImportOptions: teamspaceImportOptions ?? null,
        status: {type: "UploadPending"},
        importedCount: 0,
    };
}

/** Asserts that the unzip result is not null and returns it typed. */
function assertResult(
    result: NotionImportMappedReferencesResult | null,
): NotionImportMappedReferencesResult {
    expect(result).not.toBeNull();
    return result!;
}

/** Collects all documents across all teamspaces into a flat map. */
function getAllDocuments(result: NotionImportMappedReferencesResult) {
    const docs: Record<
        string,
        {
            id: string;
            references: Map<string, string>;
            files: Set<string>;
            parent: {documentId: string; relativeFilePath: string} | null;
            children: Set<string>;
            hasChildrenHeader: boolean;
        }
    > = {};
    for (const ts of result.teamspaces) {
        Object.assign(docs, ts.documents);
    }
    return docs;
}

/**
 * Helper to check if a references map contains a specific DocumentId as a value.
 */
function referencesHasDocumentId(references: Map<string, string>, documentId: string): boolean {
    for (const refDocumentId of references.values()) {
        if (refDocumentId === documentId) return true;
    }
    return false;
}

/**
 * Helper to get the document path based on the nested mode. In flat mode, paths
 * are at root. In nested mode, child paths include parent directory. Note: In
 * nested mode, directory names use only the document title (not "title notionId").
 * @param ancestors - Array of parent documents from root to immediate parent
 * (e.g., [grandparent, parent])
 */
function getDocumentPath(
    document: ExportedNotionDocument,
    nested: boolean,
    ...ancestors: Array<ExportedNotionDocument>
): string {
    const filename = `${document.title} ${document.notionId}.md`;
    if (nested && ancestors.length > 0) {
        const prefix = ancestors.map(p => p.title).join("/");
        return `${prefix}/${filename}`;
    }
    return filename;
}

// Run all generic tests in both flat and nested modes
describe.each([false, true])("with nested=%p", nested => {
    /** Helper to create a zip with the current nested mode */
    function createZip(items: Array<ExportedNotionDocument | ExportedNotionDatabase>) {
        return createTestNotionImportZip(items, {createFoldersForSubpages: nested});
    }

    describe("documents", () => {
        test("single document gets a DocumentId and empty relationships", async () => {
            const doc = new ExportedNotionDocument("My Page", "Hello world");
            const zip = createZip([doc]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const path = `My Page ${doc.notionId}.md`;
            expect(Object.keys(docs)).toEqual([path]);
            expect(Object.keys(result.filesToUpload)).toEqual([]);

            const entry = docs[path]!;
            expect(isId(entry.id)).toBe(true);
            expect(entry.references.size).toBe(0);
            expect(entry.files.size).toBe(0);
            expect(entry.parent).toBeNull();
            expect(entry.children.size).toBe(0);
        });

        test("multiple documents each get unique IDs", async () => {
            const doc1 = new ExportedNotionDocument("First", "");
            const doc2 = new ExportedNotionDocument("Second", "");
            const zip = createZip([doc1, doc2]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const id1 = docs[`First ${doc1.notionId}.md`]!.id;
            const id2 = docs[`Second ${doc2.notionId}.md`]!.id;
            expect(id1).not.toBe(id2);
        });
    });

    describe("databases", () => {
        test("full-page database is treated as a document", async () => {
            const database = new ExportedNotionDatabase("Tasks", [
                ["Name", "Status"],
                ["Task 1", "Done"],
            ]);
            const zip = createZip([database]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const path = `Tasks ${database.notionId}.md`;
            expect(docs[path]).toBeDefined();
            expect(isId(docs[path]!.id)).toBe(true);
        });

        test("database child of a document is a child document", async () => {
            const database = new ExportedNotionDatabase("Tracker", [["Col"], ["Val"]]);
            const page = new ExportedNotionDocument("Page", "", [database]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const pagePath = `Page ${page.notionId}.md`;
            const databasePath = nested
                ? `Page/Tracker ${database.notionId}.md`
                : `Tracker ${database.notionId}.md`;
            const pageEntry = docs[pagePath]!;
            const databaseEntry = docs[databasePath]!;
            expect(pageEntry.children.has(databaseEntry.id)).toBe(true);
            expect(databaseEntry.parent?.documentId).toBe(pageEntry.id);
        });

        test("_all.csv duplicate is excluded", async () => {
            const database = new ExportedNotionDatabase("Data", [["A"], ["B"]]);
            const zip = createZip([database]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const allCsvPath = `Data ${database.notionId}_all.csv`;
            expect(docs[allCsvPath]).toBeUndefined();
            expect(result.filesToUpload[allCsvPath]).toBeUndefined();
        });

        test("inline database referenced in body content is excluded", async () => {
            // Create a database that will be referenced inline (via toCsvReference)
            const inlineDatabase = new ExportedNotionDatabase("Inline Tasks", [
                ["Task"],
                ["Do stuff"],
            ]);
            // Reference the database inline in the document body (not as a child)
            const page = new ExportedNotionDocument(
                "Project",
                `Here are tasks:\n\n${inlineDatabase.toCsvReference()}`,
            );
            const zip = createZip([page, inlineDatabase]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Page should exist
            expect(docs[`Project ${page.notionId}.md`]).toBeDefined();
            // Inline database .md wrapper should be excluded (its content is embedded as a
            // table)
            expect(docs[`Inline Tasks ${inlineDatabase.notionId}.md`]).toBeUndefined();
        });

        test("top-level database not referenced inline is included", async () => {
            // A database at the top level with no inline references should create a document
            const database = new ExportedNotionDatabase("Standalone", [["Col"], ["Val"]]);
            const zip = createZip([database]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Database .md wrapper should exist as a document
            expect(docs[`Standalone ${database.notionId}.md`]).toBeDefined();
        });

        test("child database mentioned inline in parent body is excluded", async () => {
            // A database that is a child AND mentioned in parent's body content should be
            // treated as inline (excluded)
            const childDatabase = new ExportedNotionDatabase("Child DB", [["Col"], ["Val"]]);
            // Reference the database inline in the body (after ---) using toCsvReference
            const parent = new ExportedNotionDocument(
                "Parent",
                `Here is the database:\n\n${childDatabase.toCsvReference()}`,
                [childDatabase],
            );
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Parent should exist
            expect(docs[`Parent ${parent.notionId}.md`]).toBeDefined();
            // Child database .md wrapper should be excluded (it's inline)
            expect(docs[`Child DB ${childDatabase.notionId}.md`]).toBeUndefined();
            // Parent should not have the database as a child anymore
            const parentDocument = docs[`Parent ${parent.notionId}.md`]!;
            expect(parentDocument.children.size).toBe(0);
        });

        test("child database not mentioned inline in parent body is included", async () => {
            // A database that is a child but NOT mentioned in parent's body should create a
            // document
            const childDatabase = new ExportedNotionDatabase("Child DB", [["Col"], ["Val"]]);
            const parent = new ExportedNotionDocument("Parent", "Some content", [childDatabase]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Both should exist
            const parentPath = `Parent ${parent.notionId}.md`;
            const databasePath = nested
                ? `Parent/Child DB ${childDatabase.notionId}.md`
                : `Child DB ${childDatabase.notionId}.md`;
            expect(docs[parentPath]).toBeDefined();
            expect(docs[databasePath]).toBeDefined();
        });

        test("inline database children are tracked for cell linking", async () => {
            // Create child documents that will be children of the database
            const aliceDocument = new ExportedNotionDocument("Alice", "Alice's profile");
            const bobDocument = new ExportedNotionDocument("Bob", "Bob's profile");

            // Create a database with the children
            const database = new ExportedNotionDatabase("Team", [
                ["Name", "Role"],
                ["Alice", "Engineer"],
                ["Bob", "Designer"],
            ]);

            // Parent references the database inline
            const parent = new ExportedNotionDocument(
                "Project",
                `Team members:\n\n${database.toCsvReference()}`,
                [database],
            );

            const zip = createZip([parent, aliceDocument, bobDocument]);
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const documents = getAllDocuments(result);

            // Set up the database-children relationship manually (since test helper doesn't
            // support it)
            const aliceDocumentEntry = Object.entries(documents).find(([p]) =>
                p.includes("Alice"),
            )?.[1];
            const bobDocumentEntry = Object.entries(documents).find(([p]) =>
                p.includes("Bob"),
            )?.[1];

            // Database .md wrapper should be excluded (it's inline)
            expect(documents[`Team ${database.notionId}.md`]).toBeUndefined();

            // Alice and Bob should still exist as documents
            expect(aliceDocumentEntry).toBeDefined();
            expect(bobDocumentEntry).toBeDefined();
        });

        test("inline database children have parent=grandparent but not in grandparent children", async () => {
            // Create child documents for the database
            const aliceDocument = new ExportedNotionDocument("Alice", "Alice's profile");
            const bobDocument = new ExportedNotionDocument("Bob", "Bob's profile");

            // Create an inline database (CSV-only, no .md wrapper) with children
            const database = new ExportedNotionDatabase(
                "Team",
                [
                    ["Name", "Role"],
                    ["Alice", "Engineer"],
                    ["Bob", "Designer"],
                ],
                [aliceDocument, bobDocument], // Database children
                {inline: true}, // CSV-only database
            );

            // Parent references the database inline via toCsvReference
            const parent = new ExportedNotionDocument(
                "Project",
                `Team members:\n\n${database.toCsvReference()}`,
                [database],
            );

            const zip = createZip([parent]);
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Find the relevant entries In nested mode, database children paths include the
            // parent document's title
            const parentPath = `Project ${parent.notionId}.md`;
            const databaseChildPrefix = nested ? "Project/Team" : "Team";
            const alicePath = `${databaseChildPrefix}/Alice ${aliceDocument.notionId}.md`;
            const bobPath = `${databaseChildPrefix}/Bob ${bobDocument.notionId}.md`;

            const parentEntry = docs[parentPath];
            const aliceEntry = docs[alicePath];
            const bobEntry = docs[bobPath];

            // Database .md wrapper should be excluded (it's inline)
            const databasePath = nested
                ? `Project/Team ${database.notionId}.md`
                : `Team ${database.notionId}.md`;
            expect(docs[databasePath]).toBeUndefined();

            // Parent document should exist
            expect(parentEntry).toBeDefined();

            // Children should exist
            expect(aliceEntry).toBeDefined();
            expect(bobEntry).toBeDefined();

            // Children should have parent = grandparent (the document containing the inline
            // database)
            expect(aliceEntry!.parent?.documentId).toBe(parentEntry!.id);
            expect(bobEntry!.parent?.documentId).toBe(parentEntry!.id);

            // But children should NOT be in grandparent's children set (they only appear as
            // links in table cells)
            expect(parentEntry!.children.has(aliceEntry!.id)).toBe(false);
            expect(parentEntry!.children.has(bobEntry!.id)).toBe(false);

            // Inline database children should be tracked for cell linking
            expect(result.inlineDatabaseChildren.size).toBeGreaterThan(0);
        });

        test("root-level CSV-only database is tracked in rootLevelCsvDatabases", async () => {
            // Create child documents for a root-level inline database
            const meetingNote1 = new ExportedNotionDocument(
                "Weekly Meeting 1",
                "Notes from meeting",
            );
            const meetingNote2 = new ExportedNotionDocument("Weekly Meeting 2", "More notes");

            // Create a root-level inline database (CSV-only) with children
            const meetingDatabase = new ExportedNotionDatabase(
                "Meeting Notes",
                [
                    ["Title", "Date"],
                    ["Weekly Meeting 1", "2024-01-01"],
                    ["Weekly Meeting 2", "2024-01-08"],
                ],
                [meetingNote1, meetingNote2],
                {inline: true},
            );

            // Create with teamspaces so we have a teamspace ID
            const teamspace = new ExportedNotionTeamspace("Engineering", [meetingDatabase]);
            const zip = createTestNotionImportZip([teamspace], {createFoldersForSubpages: nested});
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            // Root-level CSV-only database should be tracked
            expect(result.rootLevelCsvDatabases.size).toBe(1);

            // The children should have their paths tracked
            const csvPath = `Meeting Notes ${meetingDatabase.notionId}.csv`;
            const databaseInfo = result.rootLevelCsvDatabases.get(csvPath);
            expect(databaseInfo).toBeDefined();
            expect(databaseInfo!.childPaths.length).toBe(2);
            expect(databaseInfo!.teamspaceId).toBe(teamspace.notionId);
        });

        test("root-level CSV-only database WITHOUT teamspaces uses implicit workspace teamspace", async () => {
            // This tests the fix for the bug where CSV-only databases at the root level of an
            // export WITHOUT teamspaces would have orphaned children. Previously, teamspaceId
            // was null in this case, so children wouldn't be tracked in rootLevelCsvDatabases.

            // Create child documents for a root-level inline database
            const person1 = new ExportedNotionDocument("Alice", "Alice's profile");
            const person2 = new ExportedNotionDocument("Bob", "Bob's profile");

            // Create a root-level inline database (CSV-only) with children
            const peopleDatabase = new ExportedNotionDatabase(
                "People",
                [
                    ["Name", "Role"],
                    ["Alice", "Engineer"],
                    ["Bob", "Designer"],
                ],
                [person1, person2],
                {inline: true},
            );

            // Create WITHOUT teamspaces - just pass the database directly
            const zip = createTestNotionImportZip([peopleDatabase], {
                createFoldersForSubpages: nested,
                workspaceName: "My Workspace",
            });
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            // Root-level CSV-only database should be tracked even without explicit teamspaces
            expect(result.rootLevelCsvDatabases.size).toBe(1);

            // The children should have their paths tracked
            const csvPath = `People ${peopleDatabase.notionId}.csv`;
            const databaseInfo = result.rootLevelCsvDatabases.get(csvPath);
            expect(databaseInfo).toBeDefined();
            expect(databaseInfo!.childPaths.length).toBe(2);

            // The teamspaceId should be the workspace ID (implicit teamspace) When there are
            // no explicit teamspaces, the workspace itself is used
            expect(databaseInfo!.teamspaceId).toBe(result.notionWorkspaceId);

            // Verify the implicit teamspace exists and has the workspace name
            expect(result.teamspaces.length).toBe(1);
            expect(result.teamspaces[0]!.id).toBe(result.notionWorkspaceId);
            expect(result.teamspaces[0]!.name).toBe("My Workspace");

            // Children should be in inlineDatabaseChildren for cell linking
            const childTitleToId = result.inlineDatabaseChildren.get(csvPath);
            expect(childTitleToId).toBeDefined();
            expect(childTitleToId!.size).toBe(2);
            expect(childTitleToId!.has("Alice")).toBe(true);
            expect(childTitleToId!.has("Bob")).toBe(true);
        });

        test("nested full-page database children have correct parent", async () => {
            // Create child documents for a full-page database
            const task1 = new ExportedNotionDocument("Task 1", "Do this");
            const task2 = new ExportedNotionDocument("Task 2", "Do that");

            // Create a full-page database (NOT inline, has .md wrapper) with children
            const taskDatabase = new ExportedNotionDatabase(
                "Tasks",
                [
                    ["Name", "Status"],
                    ["Task 1", "Open"],
                    ["Task 2", "Done"],
                ],
                [task1, task2],
                // NOT inline, so it has an .md wrapper
            );

            // Parent document contains the database as a child (not inline)
            const project = new ExportedNotionDocument("Project", "Project description", [
                taskDatabase,
            ]);

            const zip = createZip([project]);
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Find the entries In nested mode, paths include parent document's title
            const projectPath = `Project ${project.notionId}.md`;
            const databasePrefix = nested ? "Project" : "";
            const taskDatabasePath = databasePrefix
                ? `${databasePrefix}/Tasks ${taskDatabase.notionId}.md`
                : `Tasks ${taskDatabase.notionId}.md`;
            const taskPrefix = nested ? "Project/Tasks" : "Tasks";
            const task1Path = `${taskPrefix}/Task 1 ${task1.notionId}.md`;
            const task2Path = `${taskPrefix}/Task 2 ${task2.notionId}.md`;

            const projectEntry = docs[projectPath];
            const taskDatabaseEntry = docs[taskDatabasePath];
            const task1Entry = docs[task1Path];
            const task2Entry = docs[task2Path];

            // All entries should exist
            expect(projectEntry).toBeDefined();
            expect(taskDatabaseEntry).toBeDefined();
            expect(task1Entry).toBeDefined();
            expect(task2Entry).toBeDefined();

            // Database should be a child of project
            expect(taskDatabaseEntry!.parent?.documentId).toBe(projectEntry!.id);
            expect(projectEntry!.children.has(taskDatabaseEntry!.id)).toBe(true);

            // Tasks should be children of the database
            expect(task1Entry!.parent?.documentId).toBe(taskDatabaseEntry!.id);
            expect(task2Entry!.parent?.documentId).toBe(taskDatabaseEntry!.id);
            expect(taskDatabaseEntry!.children.has(task1Entry!.id)).toBe(true);
            expect(taskDatabaseEntry!.children.has(task2Entry!.id)).toBe(true);
        });

        test("root-level CSV database children are tracked in inlineDatabaseChildren for cell linking", async () => {
            // Create child documents that will become database rows
            const meeting1 = new ExportedNotionDocument("Weekly - July 6, 2025", "Meeting notes");
            const meeting2 = new ExportedNotionDocument("Standup - July 7, 2025", "Daily standup");

            // Create a root-level CSV-only database (inline mode, no .md wrapper)
            const meetingDatabase = new ExportedNotionDatabase(
                "Meeting Notes",
                [
                    ["Title", "Date"],
                    ["Weekly - July 6, 2025", "2025-07-06"],
                    ["Standup - July 7, 2025", "2025-07-07"],
                ],
                [meeting1, meeting2],
                {inline: true}, // CSV-only, no .md wrapper
            );

            // Create with teamspaces so we have a teamspace ID
            const teamspace = new ExportedNotionTeamspace("Engineering", [meetingDatabase]);
            const zip = createTestNotionImportZip([teamspace], {createFoldersForSubpages: nested});
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            // The children should be tracked in inlineDatabaseChildren
            const csvPath = `Meeting Notes ${meetingDatabase.notionId}.csv`;
            const childTitleToId = result.inlineDatabaseChildren.get(csvPath);

            expect(childTitleToId).toBeDefined();
            expect(childTitleToId!.size).toBe(2);
            expect(childTitleToId!.has("Weekly - July 6, 2025")).toBe(true);
            expect(childTitleToId!.has("Standup - July 7, 2025")).toBe(true);

            // Verify the IDs match the actual documents
            const docs = getAllDocuments(result);
            const meeting1Path = `Meeting Notes/Weekly - July 6, 2025 ${meeting1.notionId}.md`;
            const meeting2Path = `Meeting Notes/Standup - July 7, 2025 ${meeting2.notionId}.md`;

            expect(childTitleToId!.get("Weekly - July 6, 2025")).toBe(docs[meeting1Path]?.id);
            expect(childTitleToId!.get("Standup - July 7, 2025")).toBe(docs[meeting2Path]?.id);
        });

        test("deeply nested database (3 levels) maintains correct hierarchy", async () => {
            // Create a deeply nested structure: Workspace > Project > Sprint > Tasks
            // (database) > Task items
            const taskItem = new ExportedNotionDocument("Fix Bug", "Fix the bug");

            const tasksDatabase = new ExportedNotionDatabase(
                "Sprint Tasks",
                [
                    ["Name", "Priority"],
                    ["Fix Bug", "High"],
                ],
                [taskItem],
            );

            const sprint = new ExportedNotionDocument("Sprint 1", "Sprint description", [
                tasksDatabase,
            ]);
            const project = new ExportedNotionDocument("Project Alpha", "Project description", [
                sprint,
            ]);

            const zip = createZip([project]);
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // Find all entries In nested mode, each level adds to the path prefix
            const projectPath = `Project Alpha ${project.notionId}.md`;
            const sprintPath = nested
                ? `Project Alpha/Sprint 1 ${sprint.notionId}.md`
                : `Sprint 1 ${sprint.notionId}.md`;
            const tasksDatabasePath = nested
                ? `Project Alpha/Sprint 1/Sprint Tasks ${tasksDatabase.notionId}.md`
                : `Sprint Tasks ${tasksDatabase.notionId}.md`;
            const taskItemPath = nested
                ? `Project Alpha/Sprint 1/Sprint Tasks/Fix Bug ${taskItem.notionId}.md`
                : `Sprint Tasks/Fix Bug ${taskItem.notionId}.md`;

            const projectEntry = docs[projectPath];
            const sprintEntry = docs[sprintPath];
            const tasksDatabaseEntry = docs[tasksDatabasePath];
            const taskItemEntry = docs[taskItemPath];

            expect(projectEntry).toBeDefined();
            expect(sprintEntry).toBeDefined();
            expect(tasksDatabaseEntry).toBeDefined();
            expect(taskItemEntry).toBeDefined();

            // Verify hierarchy: Project > Sprint > Tasks DB > Task Item
            expect(sprintEntry!.parent?.documentId).toBe(projectEntry!.id);
            expect(tasksDatabaseEntry!.parent?.documentId).toBe(sprintEntry!.id);
            expect(taskItemEntry!.parent?.documentId).toBe(tasksDatabaseEntry!.id);

            // Verify children sets
            expect(projectEntry!.children.has(sprintEntry!.id)).toBe(true);
            expect(sprintEntry!.children.has(tasksDatabaseEntry!.id)).toBe(true);
            expect(tasksDatabaseEntry!.children.has(taskItemEntry!.id)).toBe(true);
        });
    });

    describe("files", () => {
        test("attached file gets a FileId in the files section", async () => {
            const image = new ExportedNotionFile("photo.png", "image");
            const page = new ExportedNotionDocument("Gallery", image.toReference());
            page.addFiles([image]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            const filePath = nested ? "Gallery/photo.png" : "photo.png";
            expect(result.filesToUpload[filePath]).toBeDefined();
            expect(isId(result.filesToUpload[filePath]!.id)).toBe(true);
        });

        test("file path includes document directory in nested mode", async () => {
            const image = new ExportedNotionFile("photo.png", "image");
            const page = new ExportedNotionDocument("Gallery", image.toReference());
            page.addFiles([image]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            const expectedPath = nested ? "Gallery/photo.png" : "photo.png";
            expect(result.filesToUpload[expectedPath]).toBeDefined();
        });

        test("document references file via markdown link", async () => {
            const image = new ExportedNotionFile("photo.png", "image");
            const page = new ExportedNotionDocument("Gallery", image.toReference());
            page.addFiles([image]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const pageEntry = docs[`Gallery ${page.notionId}.md`]!;
            const filePath = nested ? "Gallery/photo.png" : "photo.png";
            const fileEntry = result.filesToUpload[filePath]!;
            expect(pageEntry.files.has(fileEntry.id)).toBe(true);
        });

        test("multiple files attached to same document", async () => {
            const img = new ExportedNotionFile("a.png", "image");
            const vid = new ExportedNotionFile("b.mp4", "video");
            const page = new ExportedNotionDocument(
                "Media",
                `${img.toReference()} and ${vid.toReference()}`,
            );
            page.addFiles([img, vid]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const pageEntry = docs[`Media ${page.notionId}.md`]!;
            const imgPath = nested ? "Media/a.png" : "a.png";
            const vidPath = nested ? "Media/b.mp4" : "b.mp4";
            expect(pageEntry.files.size).toBe(2);
            expect(pageEntry.files.has(result.filesToUpload[imgPath]!.id)).toBe(true);
            expect(pageEntry.files.has(result.filesToUpload[vidPath]!.id)).toBe(true);
        });
    });

    describe("hierarchy", () => {
        test("parent-child relationship", async () => {
            const child = new ExportedNotionDocument("Child", "child content");
            const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentPath = getDocumentPath(parent, nested);
            const childPath = getDocumentPath(child, nested, parent);

            const parentEntry = docs[parentPath]!;
            const childEntry = docs[childPath]!;

            expect(childEntry.parent?.documentId).toBe(parentEntry.id);
            expect(parentEntry.children.has(childEntry.id)).toBe(true);
            expect(parentEntry.parent).toBeNull();
        });

        test("deep nesting: grandchild's parent is child, not grandparent", async () => {
            const grandchild = new ExportedNotionDocument("Grandchild", "");
            const child = new ExportedNotionDocument("Child", "", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[getDocumentPath(parent, nested)]!;
            const childEntry = docs[getDocumentPath(child, nested, parent)]!;
            const grandchildEntry = docs[getDocumentPath(grandchild, nested, parent, child)]!;

            expect(grandchildEntry.parent?.documentId).toBe(childEntry.id);
            expect(childEntry.parent?.documentId).toBe(parentEntry.id);
            expect(parentEntry.parent).toBeNull();

            expect(parentEntry.children.has(childEntry.id)).toBe(true);
            expect(parentEntry.children.has(grandchildEntry.id)).toBe(false);
            expect(childEntry.children.has(grandchildEntry.id)).toBe(true);
        });

        test("multiple children of same parent", async () => {
            const child1 = new ExportedNotionDocument("Alpha", "");
            const child2 = new ExportedNotionDocument("Beta", "");
            const parent = new ExportedNotionDocument("Parent", "", [child1, child2]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[getDocumentPath(parent, nested)]!;
            const child1Entry = docs[getDocumentPath(child1, nested, parent)]!;
            const child2Entry = docs[getDocumentPath(child2, nested, parent)]!;

            expect(parentEntry.children.size).toBe(2);
            expect(parentEntry.children.has(child1Entry.id)).toBe(true);
            expect(parentEntry.children.has(child2Entry.id)).toBe(true);
            expect(child1Entry.parent?.documentId).toBe(parentEntry.id);
            expect(child2Entry.parent?.documentId).toBe(parentEntry.id);
        });

        test("multiple top-level documents have no parent", async () => {
            const doc1 = new ExportedNotionDocument("First", "");
            const doc2 = new ExportedNotionDocument("Second", "");
            const zip = createZip([doc1, doc2]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            expect(docs[`First ${doc1.notionId}.md`]!.parent).toBeNull();
            expect(docs[`Second ${doc2.notionId}.md`]!.parent).toBeNull();
        });
    });

    describe("hasChildrenHeader", () => {
        test("document with children has hasChildrenHeader true", async () => {
            const child = new ExportedNotionDocument("Child", "child content");
            const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[`Parent ${parent.notionId}.md`]!;
            expect(parentEntry.hasChildrenHeader).toBe(true);
        });

        test("document without children has hasChildrenHeader false", async () => {
            const doc = new ExportedNotionDocument("Page", "content");
            const zip = createZip([doc]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const entry = docs[`Page ${doc.notionId}.md`]!;
            expect(entry.hasChildrenHeader).toBe(false);
        });

        test("child document has hasChildrenHeader false", async () => {
            const child = new ExportedNotionDocument("Child", "child content");
            const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const childEntry = docs[getDocumentPath(child, nested, parent)]!;
            expect(childEntry.hasChildrenHeader).toBe(false);
        });

        test("document with multiple children has hasChildrenHeader true", async () => {
            const child1 = new ExportedNotionDocument("Alpha", "");
            const child2 = new ExportedNotionDocument("Beta", "");
            const parent = new ExportedNotionDocument("Parent", "content", [child1, child2]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[`Parent ${parent.notionId}.md`]!;
            expect(parentEntry.hasChildrenHeader).toBe(true);
        });

        test("deep nesting without content: hasChildrenHeader is false for all", async () => {
            // Documents without content don't get a --- divider, so no children header to
            // remove
            const grandchild = new ExportedNotionDocument("Grandchild", "");
            const child = new ExportedNotionDocument("Child", "", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[getDocumentPath(parent, nested)]!;
            const childEntry = docs[getDocumentPath(child, nested, parent)]!;
            const grandchildEntry = docs[getDocumentPath(grandchild, nested, parent, child)]!;

            expect(parentEntry.hasChildrenHeader).toBe(false);
            expect(childEntry.hasChildrenHeader).toBe(false);
            expect(grandchildEntry.hasChildrenHeader).toBe(false);
        });

        test("deep nesting with content: parents have hasChildrenHeader true", async () => {
            // Documents with content AND children get a --- divider, so children header should
            // be removed
            const grandchild = new ExportedNotionDocument("Grandchild", "grandchild content");
            const child = new ExportedNotionDocument("Child", "child content", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[getDocumentPath(parent, nested)]!;
            const childEntry = docs[getDocumentPath(child, nested, parent)]!;
            const grandchildEntry = docs[getDocumentPath(grandchild, nested, parent, child)]!;

            expect(parentEntry.hasChildrenHeader).toBe(true);
            expect(childEntry.hasChildrenHeader).toBe(true);
            expect(grandchildEntry.hasChildrenHeader).toBe(false);
        });
    });

    describe("references", () => {
        test("document referencing child in content", async () => {
            const child = new ExportedNotionDocument("Sub Page", "");
            const parent = new ExportedNotionDocument(
                "Parent",
                `See ${child.toReference()} for details`,
                [child],
            );
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentEntry = docs[getDocumentPath(parent, nested)]!;
            const childEntry = docs[getDocumentPath(child, nested, parent)]!;

            expect(referencesHasDocumentId(parentEntry.references, childEntry.id)).toBe(true);
        });

        test("circular references: A references B and B references A", async () => {
            const a = new ExportedNotionDocument("Doc A", "");
            const b = new ExportedNotionDocument("Doc B", "");
            a.content = `Link to ${b.toReference()}`;
            b.content = `Link to ${a.toReference()}`;

            const parent = new ExportedNotionDocument("Parent", "", [a, b]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const aEntry = docs[getDocumentPath(a, nested, parent)]!;
            const bEntry = docs[getDocumentPath(b, nested, parent)]!;

            expect(referencesHasDocumentId(aEntry.references, bEntry.id)).toBe(true);
            expect(referencesHasDocumentId(bEntry.references, aEntry.id)).toBe(true);
        });

        test("three-way circular: A→B, B→C, C→A", async () => {
            const a = new ExportedNotionDocument("Doc A", "");
            const b = new ExportedNotionDocument("Doc B", "");
            const c = new ExportedNotionDocument("Doc C", "");
            a.content = `Link to ${b.toReference()}`;
            b.content = `Link to ${c.toReference()}`;
            c.content = `Link to ${a.toReference()}`;

            const parent = new ExportedNotionDocument("Parent", "", [a, b, c]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const aEntry = docs[getDocumentPath(a, nested, parent)]!;
            const bEntry = docs[getDocumentPath(b, nested, parent)]!;
            const cEntry = docs[getDocumentPath(c, nested, parent)]!;

            expect(referencesHasDocumentId(aEntry.references, bEntry.id)).toBe(true);
            expect(referencesHasDocumentId(bEntry.references, cEntry.id)).toBe(true);
            expect(referencesHasDocumentId(cEntry.references, aEntry.id)).toBe(true);
        });

        test("three siblings all referencing each other", async () => {
            const a = new ExportedNotionDocument("Doc A", "");
            const b = new ExportedNotionDocument("Doc B", "");
            const c = new ExportedNotionDocument("Doc C", "");
            a.content = `${b.toReference()} and ${c.toReference()}`;
            b.content = `${a.toReference()} and ${c.toReference()}`;
            c.content = `${a.toReference()} and ${b.toReference()}`;

            const parent = new ExportedNotionDocument("Parent", "", [a, b, c]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const aEntry = docs[getDocumentPath(a, nested, parent)]!;
            const bEntry = docs[getDocumentPath(b, nested, parent)]!;
            const cEntry = docs[getDocumentPath(c, nested, parent)]!;

            expect(aEntry.references.size).toBe(2);
            expect(referencesHasDocumentId(aEntry.references, bEntry.id)).toBe(true);
            expect(referencesHasDocumentId(aEntry.references, cEntry.id)).toBe(true);

            expect(bEntry.references.size).toBe(2);
            expect(referencesHasDocumentId(bEntry.references, aEntry.id)).toBe(true);
            expect(referencesHasDocumentId(bEntry.references, cEntry.id)).toBe(true);

            expect(cEntry.references.size).toBe(2);
            expect(referencesHasDocumentId(cEntry.references, aEntry.id)).toBe(true);
            expect(referencesHasDocumentId(cEntry.references, bEntry.id)).toBe(true);
        });

        test("backward reference: child references grandparent", async () => {
            const root = new ExportedNotionDocument("Root", "root content");
            const grandchild = new ExportedNotionDocument("Leaf", "");
            grandchild.content = `Back to ${root.toReference()}`;
            const child = new ExportedNotionDocument("Mid", "", [grandchild]);
            root.addChildren([child]);

            const zip = createZip([root]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const rootEntry = docs[getDocumentPath(root, nested)]!;
            const grandchildEntry = docs[getDocumentPath(grandchild, nested, root, child)]!;

            expect(referencesHasDocumentId(grandchildEntry.references, rootEntry.id)).toBe(true);
        });

        test("reference to full-page database", async () => {
            const database = new ExportedNotionDatabase("Tasks", [["Name"], ["Task 1"]]);
            const document = new ExportedNotionDocument("Page", `See ${database.toReference()}`);
            const zip = createZip([document, database]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const documentEntry = docs[`Page ${document.notionId}.md`]!;
            const databaseEntry = docs[`Tasks ${database.notionId}.md`]!;

            expect(referencesHasDocumentId(documentEntry.references, databaseEntry.id)).toBe(true);
        });

        test("external URLs are not treated as references", async () => {
            const doc = new ExportedNotionDocument(
                "Page",
                "Visit [Google](https://google.com) and [Docs](http://docs.example.com)",
            );
            const zip = createZip([doc]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const entry = docs[`Page ${doc.notionId}.md`]!;
            expect(entry.references.size).toBe(0);
        });

        test("references use correct paths", async () => {
            const child = new ExportedNotionDocument("Sub", "");
            const parent = new ExportedNotionDocument("Parent", `See ${child.toReference()}`, [
                child,
            ]);
            const zip = createZip([parent]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            const parentPath = getDocumentPath(parent, nested);
            const childPath = getDocumentPath(child, nested, parent);

            const parentEntry = docs[parentPath]!;
            const childEntry = docs[childPath]!;

            expect(referencesHasDocumentId(parentEntry.references, childEntry.id)).toBe(true);
        });
    });

    describe("exclusions", () => {
        test("index.html is not in the result", async () => {
            const doc = new ExportedNotionDocument("Page", "content");
            const zip = createZip([doc]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            for (const path of Object.keys(docs)) {
                expect(path).not.toContain("index.html");
            }
            for (const path of Object.keys(result.filesToUpload)) {
                expect(path).not.toContain("index.html");
            }
        });
    });

    describe("exhaustive tree", () => {
        const arbitraryReferenceCount = 25;

        const fileTypes: Array<"image" | "video" | "audio"> = ["image", "video", "audio"];
        const fileExtensions = {image: ".png", video: ".mp4", audio: ".mp3"};

        test("5 layers deep, 25+ children per root, 25 files and 25 references", async () => {
            // --- Build tree A (5 layers deep) --- Layer 5 (deepest leaves under A)
            const a0000 = new ExportedNotionDocument("A-0-0-0-0", "");
            const a0001 = new ExportedNotionDocument("A-0-0-0-1", "");

            // Layer 4
            const a000 = new ExportedNotionDocument("A-0-0-0", "", [a0000, a0001]);
            const a001 = new ExportedNotionDocument("A-0-0-1", "");
            const a002 = new ExportedNotionDocument("A-0-0-2", "");

            // Layer 3
            const a00 = new ExportedNotionDocument("A-0-0", "", [a000, a001, a002]);
            const a01 = new ExportedNotionDocument("A-0-1", "");
            const a02 = new ExportedNotionDocument("A-0-2", "");
            const a03 = new ExportedNotionDocument("A-0-3", "");
            const a04 = new ExportedNotionDocument("A-0-4", "");

            // Layer 2 (A's direct children)
            const a0 = new ExportedNotionDocument("A-0", "", [a00, a01, a02, a03, a04]);
            const a1 = new ExportedNotionDocument("A-1", "");
            const a2 = new ExportedNotionDocument("A-2", "");
            const a3 = new ExportedNotionDocument("A-3", "");
            const aLeaves: Array<ExportedNotionDocument> = [];
            for (let i = 4; i < arbitraryReferenceCount; i++) {
                aLeaves.push(new ExportedNotionDocument(`A-${i}`, ""));
            }
            const allAChildren = [a0, a1, a2, a3, ...aLeaves];

            // Layer 1 (Root A)
            const rootA = new ExportedNotionDocument("Root A", "", allAChildren);

            // --- Build tree B (5 layers deep) --- Layer 5 (deepest leaves under B)
            const b0000 = new ExportedNotionDocument("B-0-0-0-0", "");
            const b0001 = new ExportedNotionDocument("B-0-0-0-1", "");

            // Layer 4
            const b000 = new ExportedNotionDocument("B-0-0-0", "", [b0000, b0001]);
            const b001 = new ExportedNotionDocument("B-0-0-1", "");
            const b002 = new ExportedNotionDocument("B-0-0-2", "");

            // Layer 3
            const b00 = new ExportedNotionDocument("B-0-0", "", [b000, b001, b002]);
            const b01 = new ExportedNotionDocument("B-0-1", "");
            const b02 = new ExportedNotionDocument("B-0-2", "");
            const b03 = new ExportedNotionDocument("B-0-3", "");
            const b04 = new ExportedNotionDocument("B-0-4", "");

            // Layer 2 (B's direct children)
            const b0 = new ExportedNotionDocument("B-0", "", [b00, b01, b02, b03, b04]);
            const b1 = new ExportedNotionDocument("B-1", "");
            const b2 = new ExportedNotionDocument("B-2", "");
            const b3 = new ExportedNotionDocument("B-3", "");
            const bLeaves: Array<ExportedNotionDocument> = [];
            for (let i = 4; i < arbitraryReferenceCount; i++) {
                bLeaves.push(new ExportedNotionDocument(`B-${i}`, ""));
            }
            const allBChildren = [b0, b1, b2, b3, ...bLeaves];

            // Layer 1 (Root B)
            const rootB = new ExportedNotionDocument("Root B", "", allBChildren);

            // --- Attach 25 files to A-1 ---
            const a1Files: Array<ExportedNotionFile> = [];
            for (let i = 0; i < arbitraryReferenceCount; i++) {
                const type = fileTypes[i % 3]!;
                const ext = fileExtensions[type];
                a1Files.push(new ExportedNotionFile(`file-a1-${i}${ext}`, type));
            }
            a1.content = a1Files.map(f => f.toReference()).join(" ");
            a1.addFiles(a1Files);

            // --- Attach 25 files to B-1 ---
            const b1Files: Array<ExportedNotionFile> = [];
            for (let i = 0; i < arbitraryReferenceCount; i++) {
                const type = fileTypes[i % 3]!;
                const ext = fileExtensions[type];
                b1Files.push(new ExportedNotionFile(`file-b1-${i}${ext}`, type));
            }
            b1.content = b1Files.map(f => f.toReference()).join(" ");
            b1.addFiles(b1Files);

            // --- A-2 references all 25 of B's children ---
            a2.content = allBChildren.map(b => b.toReference()).join(" ");

            // --- B-2 references all 25 of A's children ---
            b2.content = allAChildren.map(a => a.toReference()).join(" ");

            // --- Circular references: A-3 ↔ B-3 ---
            a3.content = `Link to ${b3.toReference()}`;
            b3.content = `Link to ${a3.toReference()}`;

            // --- Create zip and process ---
            const zip = createZip([rootA, rootB]);
            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );
            const docs = getAllDocuments(result);

            // --- Collect all expected documents ---
            const allADocs = [
                rootA,
                a0,
                a1,
                a2,
                a3,
                ...aLeaves,
                a00,
                a01,
                a02,
                a03,
                a04,
                a000,
                a001,
                a002,
                a0000,
                a0001,
            ];
            const allBDocs = [
                rootB,
                b0,
                b1,
                b2,
                b3,
                ...bLeaves,
                b00,
                b01,
                b02,
                b03,
                b04,
                b000,
                b001,
                b002,
                b0000,
                b0001,
            ];
            const allDocs = [...allADocs, ...allBDocs];

            // --- Assert document and file counts ---
            expect(Object.keys(docs)).toHaveLength(allDocs.length);
            expect(Object.keys(result.filesToUpload)).toHaveLength(arbitraryReferenceCount * 2);

            // --- Build path map for nested mode --- In nested mode, directory names use only
            // the title (not "title notionId")
            const pathMap = new Map<ExportedNotionDocument, string>();
            function buildPath(
                doc: ExportedNotionDocument,
                ancestors: Array<ExportedNotionDocument>,
            ) {
                const filename = `${doc.title} ${doc.notionId}.md`;
                if (nested && ancestors.length > 0) {
                    const prefix = ancestors.map(p => p.title).join("/");
                    pathMap.set(doc, `${prefix}/${filename}`);
                } else {
                    pathMap.set(doc, filename);
                }
            }

            // Build paths for tree A
            buildPath(rootA, []);
            for (const child of allAChildren) {
                buildPath(child, [rootA]);
            }
            buildPath(a00, [rootA, a0]);
            buildPath(a01, [rootA, a0]);
            buildPath(a02, [rootA, a0]);
            buildPath(a03, [rootA, a0]);
            buildPath(a04, [rootA, a0]);
            buildPath(a000, [rootA, a0, a00]);
            buildPath(a001, [rootA, a0, a00]);
            buildPath(a002, [rootA, a0, a00]);
            buildPath(a0000, [rootA, a0, a00, a000]);
            buildPath(a0001, [rootA, a0, a00, a000]);

            // Build paths for tree B
            buildPath(rootB, []);
            for (const child of allBChildren) {
                buildPath(child, [rootB]);
            }
            buildPath(b00, [rootB, b0]);
            buildPath(b01, [rootB, b0]);
            buildPath(b02, [rootB, b0]);
            buildPath(b03, [rootB, b0]);
            buildPath(b04, [rootB, b0]);
            buildPath(b000, [rootB, b0, b00]);
            buildPath(b001, [rootB, b0, b00]);
            buildPath(b002, [rootB, b0, b00]);
            buildPath(b0000, [rootB, b0, b00, b000]);
            buildPath(b0001, [rootB, b0, b00, b000]);

            // --- Helper: get entry by document ---
            function getDoc(doc: ExportedNotionDocument) {
                const path = pathMap.get(doc)!;
                const entry = docs[path];
                expect(entry).toBeDefined();
                return entry!;
            }

            function getFile(basePath: string) {
                // In nested mode, files under a document are prefixed with document directory
                const path = basePath;
                const entry = result.filesToUpload[path];
                expect(entry).toBeDefined();
                return entry!;
            }

            // --- Helper: assert document relationships ---
            function assertDoc(
                doc: ExportedNotionDocument,
                expected: {
                    parent: ExportedNotionDocument | null;
                    children: Array<ExportedNotionDocument>;
                    references: Array<ExportedNotionDocument>;
                    filePaths: Array<string>;
                },
            ) {
                const entry = getDoc(doc);

                // Parent
                if (expected.parent === null) {
                    expect(entry.parent).toBeNull();
                } else {
                    expect(entry.parent?.documentId).toBe(getDoc(expected.parent).id);
                }

                // Children
                expect(entry.children.size).toBe(expected.children.length);
                for (const child of expected.children) {
                    expect(entry.children.has(getDoc(child).id)).toBe(true);
                }

                // References
                expect(entry.references.size).toBe(expected.references.length);
                for (const ref of expected.references) {
                    expect(referencesHasDocumentId(entry.references, getDoc(ref).id)).toBe(true);
                }

                // Files
                expect(entry.files.size).toBe(expected.filePaths.length);
                for (const fp of expected.filePaths) {
                    expect(entry.files.has(getFile(fp).id)).toBe(true);
                }
            }

            // --- Assert Root A ---
            assertDoc(rootA, {
                parent: null,
                children: allAChildren,
                references: allAChildren,
                filePaths: [],
            });

            // --- Assert A-0 (has 5 layer-3 children) ---
            const a0Children = [a00, a01, a02, a03, a04];
            assertDoc(a0, {
                parent: rootA,
                children: a0Children,
                references: a0Children,
                filePaths: [],
            });

            // --- Assert A-0-0 (has 3 layer-4 children) ---
            const a00Children = [a000, a001, a002];
            assertDoc(a00, {
                parent: a0,
                children: a00Children,
                references: a00Children,
                filePaths: [],
            });

            // --- Assert A-0-0-0 (has 2 layer-5 children) ---
            const a000Children = [a0000, a0001];
            assertDoc(a000, {
                parent: a00,
                children: a000Children,
                references: a000Children,
                filePaths: [],
            });

            // --- Assert layer-5 leaves ---
            assertDoc(a0000, {parent: a000, children: [], references: [], filePaths: []});
            assertDoc(a0001, {parent: a000, children: [], references: [], filePaths: []});

            // --- Assert layer-4 leaves ---
            assertDoc(a001, {parent: a00, children: [], references: [], filePaths: []});
            assertDoc(a002, {parent: a00, children: [], references: [], filePaths: []});

            // --- Assert layer-3 leaves ---
            assertDoc(a01, {parent: a0, children: [], references: [], filePaths: []});
            assertDoc(a02, {parent: a0, children: [], references: [], filePaths: []});
            assertDoc(a03, {parent: a0, children: [], references: [], filePaths: []});
            assertDoc(a04, {parent: a0, children: [], references: [], filePaths: []});

            // --- Assert A-1 (25 files, no doc references) --- In nested mode, files are in
            // "Parent Title/Doc Title/" directories
            const a1FileDir = nested ? "Root A/A-1/" : "";
            const a1FilePaths = a1Files.map((f, i) => {
                const ext = fileExtensions[fileTypes[i % 3]!];
                return `${a1FileDir}file-a1-${i}${ext}`;
            });
            assertDoc(a1, {
                parent: rootA,
                children: [],
                references: [],
                filePaths: a1FilePaths,
            });

            // --- Assert A-2 (references 25 B children) ---
            assertDoc(a2, {
                parent: rootA,
                children: [],
                references: allBChildren,
                filePaths: [],
            });

            // --- Assert A-3 (circular ref with B-3) ---
            assertDoc(a3, {
                parent: rootA,
                children: [],
                references: [b3],
                filePaths: [],
            });

            // --- Assert A-4 through A-24 (plain leaves) ---
            for (const leaf of aLeaves) {
                assertDoc(leaf, {parent: rootA, children: [], references: [], filePaths: []});
            }

            // --- Assert Root B ---
            assertDoc(rootB, {
                parent: null,
                children: allBChildren,
                references: allBChildren,
                filePaths: [],
            });

            // --- Assert B-0 (has 5 layer-3 children) ---
            const b0Children = [b00, b01, b02, b03, b04];
            assertDoc(b0, {
                parent: rootB,
                children: b0Children,
                references: b0Children,
                filePaths: [],
            });

            // --- Assert B-0-0 (has 3 layer-4 children) ---
            const b00Children = [b000, b001, b002];
            assertDoc(b00, {
                parent: b0,
                children: b00Children,
                references: b00Children,
                filePaths: [],
            });

            // --- Assert B-0-0-0 (has 2 layer-5 children) ---
            const b000Children = [b0000, b0001];
            assertDoc(b000, {
                parent: b00,
                children: b000Children,
                references: b000Children,
                filePaths: [],
            });

            // --- Assert B layer-5 leaves ---
            assertDoc(b0000, {parent: b000, children: [], references: [], filePaths: []});
            assertDoc(b0001, {parent: b000, children: [], references: [], filePaths: []});

            // --- Assert B layer-4 leaves ---
            assertDoc(b001, {parent: b00, children: [], references: [], filePaths: []});
            assertDoc(b002, {parent: b00, children: [], references: [], filePaths: []});

            // --- Assert B layer-3 leaves ---
            assertDoc(b01, {parent: b0, children: [], references: [], filePaths: []});
            assertDoc(b02, {parent: b0, children: [], references: [], filePaths: []});
            assertDoc(b03, {parent: b0, children: [], references: [], filePaths: []});
            assertDoc(b04, {parent: b0, children: [], references: [], filePaths: []});

            // --- Assert B-1 (25 files, no doc references) --- In nested mode, files are in
            // "Parent Title/Doc Title/" directories
            const b1FileDir = nested ? "Root B/B-1/" : "";
            const b1FilePaths = b1Files.map((f, i) => {
                const ext = fileExtensions[fileTypes[i % 3]!];
                return `${b1FileDir}file-b1-${i}${ext}`;
            });
            assertDoc(b1, {
                parent: rootB,
                children: [],
                references: [],
                filePaths: b1FilePaths,
            });

            // --- Assert B-2 (references 25 A children) ---
            assertDoc(b2, {
                parent: rootB,
                children: [],
                references: allAChildren,
                filePaths: [],
            });

            // --- Assert B-3 (circular ref with A-3) ---
            assertDoc(b3, {
                parent: rootB,
                children: [],
                references: [a3],
                filePaths: [],
            });

            // --- Assert B-4 through B-24 (plain leaves) ---
            for (const leaf of bLeaves) {
                assertDoc(leaf, {parent: rootB, children: [], references: [], filePaths: []});
            }

            // --- Assert all files exist with valid IDs ---
            for (const filePath of [...a1FilePaths, ...b1FilePaths]) {
                expect(isId(getFile(filePath).id)).toBe(true);
            }

            // --- Assert all documents have valid IDs ---
            for (const doc of allDocs) {
                expect(isId(getDoc(doc).id)).toBe(true);
            }

            // --- Assert all IDs are unique ---
            const allIds = [
                ...allDocs.map(d => getDoc(d).id),
                ...[...a1FilePaths, ...b1FilePaths].map(fp => getFile(fp).id),
            ];
            expect(new Set(allIds).size).toBe(allIds.length);
        });
    });

    describe("filePathToTeamspaceId", () => {
        test("file referenced via markdown link is tracked", async () => {
            const file = new ExportedNotionFile("photo.png", "image");
            const page = new ExportedNotionDocument("Gallery", file.toReference());
            page.addFiles([file]);
            const zip = createZip([page]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            const filePath = nested ? "Gallery/photo.png" : "photo.png";
            expect(result.filePathToTeamspaceId.has(filePath)).toBe(true);
        });

        test("raw file path in database property is tracked", async () => {
            const file = new ExportedNotionFile("photo.png", "image");
            // The file path in the property value must match the actual location in the zip so
            // it resolves against pathToFileId.
            const rawFilePath = nested ? "Task/photo.png" : "photo.png";
            const row = new ExportedNotionDocument(
                "Task",
                `Files: ${rawFilePath}\nStatus: Done\n\nSome description`,
            );
            row.addFiles([file]);
            const zip = createZip([row]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            expect(result.filePathToTeamspaceId.has(rawFilePath)).toBe(true);
            // Verify the file is also in the document's files set
            const docs = getAllDocuments(result);
            const docEntry = docs[`Task ${row.notionId}.md`]!;
            const fileId = result.filesToUpload[rawFilePath]!.id;
            expect(docEntry.files.has(fileId)).toBe(true);
        });

        test("multiple raw file paths in one database property are tracked", async () => {
            const file1 = new ExportedNotionFile("a.png", "image");
            const file2 = new ExportedNotionFile("b.png", "image");
            const path1 = nested ? "Row/a.png" : "a.png";
            const path2 = nested ? "Row/b.png" : "b.png";
            const row = new ExportedNotionDocument(
                "Row",
                `Attachments: ${path1}, ${path2}\nStatus: Active\n\nContent here`,
            );
            row.addFiles([file1, file2]);
            const zip = createZip([row]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            expect(result.filePathToTeamspaceId.has(path1)).toBe(true);
            expect(result.filePathToTeamspaceId.has(path2)).toBe(true);
        });

        test("file path in CSV cell is tracked", async () => {
            const file = new ExportedNotionFile("photo.png", "image");
            // Attach the file to a document so it ends up in the zip
            const page = new ExportedNotionDocument("Page", file.toReference());
            page.addFiles([file]);

            // Create a database whose CSV cells reference the file by path
            const filePath = nested ? "Page/photo.png" : "photo.png";
            const database = new ExportedNotionDatabase("Tasks", [
                ["Name", "Attachment"],
                ["Item", filePath],
            ]);
            const zip = createZip([page, database]);

            const result = assertResult(
                await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
            );

            expect(result.filePathToTeamspaceId.has(filePath)).toBe(true);
        });
    });
});

describe("real notion export fixtures", () => {
    // These tests use real exports from Notion to verify the parser handles actual
    // Notion export format correctly.

    function readFixture(name: string): Uint8Array {
        const runfiles = process.env.RUNFILES;
        const base = runfiles ? join(runfiles, "cyberworlds") : ".";
        return new Uint8Array(
            readFileSync(join(base, "server/importer/notion/test_fixtures", name)),
        );
    }

    type DocAssertions = {
        parent?: string;
        children?: Array<string>;
        references?: Array<string>;
        files?: Array<string>;
    };

    function assertResultWithAssertions(
        result: NotionImportMappedReferencesResult | null,
        expectedDocPaths: Array<string>,
        expectedFilePaths: Array<string>,
        docAssertions: Record<string, DocAssertions>,
    ): void {
        expect(result).not.toBeNull();
        const docs = getAllDocuments(result!);

        // Assert exact document paths
        expect(Object.keys(docs).sort()).toEqual(expectedDocPaths.sort());

        // Assert exact file paths
        expect(Object.keys(result!.filesToUpload).sort()).toEqual(expectedFilePaths.sort());

        // Assert all IDs are valid and unique
        const allIds: Array<string> = [];
        for (const doc of Object.values(docs)) {
            expect(isId(doc.id)).toBe(true);
            allIds.push(doc.id);
        }
        for (const file of Object.values(result!.filesToUpload)) {
            expect(isId(file.id)).toBe(true);
            allIds.push(file.id);
        }
        expect(new Set(allIds).size).toBe(allIds.length);

        // Assert relationships
        for (const [path, assertions] of Object.entries(docAssertions)) {
            const doc = docs[path];
            expect(doc).toBeDefined();
            if (!doc) continue;

            if (assertions.parent !== undefined) {
                const parentDoc = docs[assertions.parent];
                expect(parentDoc).toBeDefined();
                expect(doc.parent?.documentId).toBe(parentDoc!.id);
            } else {
                expect(doc.parent).toBeNull();
            }

            if (assertions.children !== undefined) {
                expect(doc.children.size).toBe(assertions.children.length);
                for (const childPath of assertions.children) {
                    const childDoc = docs[childPath];
                    expect(childDoc).toBeDefined();
                    expect(doc.children.has(childDoc!.id)).toBe(true);
                }
            } else {
                expect(doc.children.size).toBe(0);
            }

            if (assertions.references !== undefined) {
                expect(doc.references.size).toBe(assertions.references.length);
                for (const refPath of assertions.references) {
                    const refDoc = docs[refPath];
                    expect(refDoc).toBeDefined();
                    expect(referencesHasDocumentId(doc.references, refDoc!.id)).toBe(true);
                }
            } else {
                expect(doc.references.size).toBe(0);
            }

            if (assertions.files !== undefined) {
                expect(doc.files.size).toBe(assertions.files.length);
                for (const filePath of assertions.files) {
                    const file = result!.filesToUpload[filePath];
                    expect(file).toBeDefined();
                    expect(doc.files.has(file!.id)).toBe(true);
                }
            } else {
                expect(doc.files.size).toBe(0);
            }
        }
    }

    // Shared notion IDs used in file names across both exports
    const ids = {
        home: "044ea0938d99484aadb0ffc0b15a26e7",
        empty: "2e780a22fe37800caa29ea205fa6caf5",
        pageParent: "2e780a22fe378050b849ca975632d12e",
        gettingStarted: "2e780a22fe378077aa03f9000c75df42",
        toDoList: "2e780a22fe3780fca551ee192270dc54",
        personalWebsite: "2e780a22fe37814f882cf165e434a63d",
        journal: "2e780a22fe3781b1a044d6c8a1080049",
        nestedPage: "2e780a22fe378077816bd4f5ada58862",
        databasePage: "2e780a22fe3780eaada4e822ec61c95f",
        markdownTests: "2f080a22fe3780299073efa14a21ecff",
        publishRelease: "2e780a22fe3780509f24f8e659a7c697",
        untitled1: "2e780a22fe37808d9a64c256c4e40a19",
        improveWebsite: "2e780a22fe3780bfa86ae18ba2791591",
        updateHelp: "2e780a22fe3780e19c5ed34e9a0dafc4",
        clickMeDetail: "2e780a22fe3780269d1bea18da260188",
        checkBox: "2e780a22fe37806eb413e1a15e9ec071",
        hideChecked: "2e780a22fe378082a05ccc73edf7aa15",
        seeContentYourWay: "2e780a22fe3780a18bb4f3f9c8643d6d",
        doneView: "2e780a22fe3780b6b196d5812a1a8ade",
        blueNewButton: "2e780a22fe3780ebb645f53a8b68f6c8",
        dueDateChange: "2e780a22fe3780f0a59bf795b77f2e3f",
        joshJohnson: "56080a22fe3783a981d5010c29fe3182",
        doubleNested: "2e780a22fe37803c8205c592e8b2dafb",
        anotherDoubleNested: "2e780a22fe37803da71fc3a97b205374",
        inline1: "2e780a22fe3780118553d0296fb636a3",
        inline2: "2e780a22fe3780c3a6c3c638c7a40170",
        inline3: "2e780a22fe3780e4b101ff0a3ded869f",
        fullPage1: "2e780a22fe37808fbf67f06d51ca4dfe",
        fullPage2: "2e780a22fe3780a3a314dae31baaaca2",
        fullPage3: "2e780a22fe3780e0b388ebfa3dd0603b",
        untitled2: "2f080a22fe378064b752c11fc0a33e86",
        exampleSubPage: "2e780a22fe378089a86ec895bd3e7f5a",
    };

    test("flat export (JJ-Test-Flat.zip) - real export from Notion", async () => {
        const zip = readFixture("JJ-Test-Flat.zip");
        const result = assertResult(
            await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
        );

        // Note: Home file is excluded because it only contains CSV links
        const docPaths = [
            `Empty ${ids.empty}.md`,
            `Page Parent ${ids.pageParent}.md`,
            `Getting Started ${ids.gettingStarted}.md`,
            `To Do List ${ids.toDoList}.md`,
            `Personal Website ${ids.personalWebsite}.md`,
            `Journal ${ids.journal}.md`,
            `I’m a nested page ${ids.nestedPage}.md`,
            `Database Page ${ids.databasePage}.md`,
            `Markdown Tests ${ids.markdownTests}.md`,
            `Publish release notes ${ids.publishRelease}.md`,
            `Untitled ${ids.untitled1}.md`,
            `Improve website copy ${ids.improveWebsite}.md`,
            `Update help center & FAQ ${ids.updateHelp}.md`,
            `Click me to see even more detail ${ids.clickMeDetail}.md`,
            `Check the box to mark items as done ${ids.checkBox}.md`,
            `Click me to learn how to hide checked items ${ids.hideChecked}.md`,
            `Click me to learn how to see your content your way ${ids.seeContentYourWay}.md`,
            `See finished items in the \u201CDone\u201D view ${ids.doneView}.md`,
            `Click the blue New button to add a task ${ids.blueNewButton}.md`,
            `Click the due date to change it ${ids.dueDateChange}.md`,
            `Josh Johnson ${ids.joshJohnson}.md`,
            `I’m a double nested page ${ids.doubleNested}.md`,
            `Another double nested page ${ids.anotherDoubleNested}.md`,
            `Inline 1 ${ids.inline1}.md`,
            `Inline 2 ${ids.inline2}.md`,
            `Inline 3 ${ids.inline3}.md`,
            `Full Page 1 ${ids.fullPage1}.md`,
            `Full Page 2 ${ids.fullPage2}.md`,
            `Full Page 3 ${ids.fullPage3}.md`,
            `Untitled ${ids.untitled2}.md`,
            `Example sub-page ${ids.exampleSubPage}.md`,
        ];

        const filePaths = [
            "person.png",
            "image.png",
            "image 1.png",
            "image 2.png",
            "image 3.png",
            "image 4.png",
            "image 5.png",
            "image 6.png",
            "IMG_8627.jpg",
            "IMG_7190.jpg",
            "21p.mp4",
        ];

        const nestedPagePath = `I’m a nested page ${ids.nestedPage}.md`;
        const doubleNestedPath = `I’m a double nested page ${ids.doubleNested}.md`;

        const pageParent = `Page Parent ${ids.pageParent}.md`;
        const databasePage = `Database Page ${ids.databasePage}.md`;
        const markdownTests = `Markdown Tests ${ids.markdownTests}.md`;

        // Note: Children of CSV-only inline databases do NOT have parent-child
        // relationships. They are only tracked in inlineDatabaseChildren for cell linking
        // in the table. This is by design to avoid having them appear both in the table
        // cells AND in a "Child documents" section.
        assertResultWithAssertions(result, docPaths, filePaths, {
            [`Empty ${ids.empty}.md`]: {},
            [pageParent]: {
                // Only direct .md children, NOT children of CSV-only databases
                children: [nestedPagePath, databasePage, markdownTests],
                references: [nestedPagePath, databasePage, markdownTests],
            },
            [`Getting Started ${ids.gettingStarted}.md`]: {
                references: [nestedPagePath],
            },
            // To Do List has an inline database - its children don't appear here
            [`To Do List ${ids.toDoList}.md`]: {},
            [`Personal Website ${ids.personalWebsite}.md`]: {
                files: ["person.png"],
            },
            [`Journal ${ids.journal}.md`]: {},
            [nestedPagePath]: {
                parent: pageParent,
                children: [
                    doubleNestedPath,
                    `Another double nested page ${ids.anotherDoubleNested}.md`,
                ],
                references: [
                    doubleNestedPath,
                    `Another double nested page ${ids.anotherDoubleNested}.md`,
                    `Getting Started ${ids.gettingStarted}.md`,
                ],
            },
            // Database Page has an inline database - its children don't appear here
            [databasePage]: {
                parent: pageParent,
            },
            // Markdown Tests has an inline database - its children don't appear here
            [markdownTests]: {
                parent: pageParent,
                references: [`Getting Started ${ids.gettingStarted}.md`],
            },
            // Children of CSV-only databases have parent = grandparent (the document
            // containing the inline database). They have a "Parent document" link but don't
            // appear in the parent's "Child documents" section.
            [`Publish release notes ${ids.publishRelease}.md`]: {parent: pageParent},
            [`Untitled ${ids.untitled1}.md`]: {parent: pageParent},
            [`Improve website copy ${ids.improveWebsite}.md`]: {parent: pageParent},
            [`Update help center & FAQ ${ids.updateHelp}.md`]: {parent: pageParent},
            // These are children of a CSV-only database inside To Do List
            [`Click me to see even more detail ${ids.clickMeDetail}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
                // This doc has a child page and references it
                children: [`Example sub-page ${ids.exampleSubPage}.md`],
                references: [`Example sub-page ${ids.exampleSubPage}.md`],
            },
            [`Check the box to mark items as done ${ids.checkBox}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
            },
            [`Click me to learn how to hide checked items ${ids.hideChecked}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
                files: ["image.png", "image 1.png", "image 2.png"],
            },
            [`Click me to learn how to see your content your way ${ids.seeContentYourWay}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
                files: ["image 3.png", "image 4.png", "image 5.png"],
            },
            [`See finished items in the \u201CDone\u201D view ${ids.doneView}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
                files: ["image 6.png"],
            },
            [`Click the blue New button to add a task ${ids.blueNewButton}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
            },
            [`Click the due date to change it ${ids.dueDateChange}.md`]: {
                parent: `To Do List ${ids.toDoList}.md`,
            },
            [`Josh Johnson ${ids.joshJohnson}.md`]: {},
            [doubleNestedPath]: {
                parent: nestedPagePath,
            },
            [`Another double nested page ${ids.anotherDoubleNested}.md`]: {
                parent: nestedPagePath,
                files: ["IMG_8627.jpg", "IMG_7190.jpg"],
            },
            // Children of inline database in Database Page - parent = Database Page
            [`Inline 1 ${ids.inline1}.md`]: {parent: databasePage},
            [`Inline 2 ${ids.inline2}.md`]: {parent: databasePage},
            [`Inline 3 ${ids.inline3}.md`]: {parent: databasePage},
            // Children of CSV-only "Full Page" database - parent = Page Parent
            [`Full Page 1 ${ids.fullPage1}.md`]: {parent: pageParent},
            [`Full Page 2 ${ids.fullPage2}.md`]: {parent: pageParent},
            [`Full Page 3 ${ids.fullPage3}.md`]: {
                parent: pageParent,
                files: ["21p.mp4"],
            },
            // Child of inline database in Markdown Tests - parent = Markdown Tests
            [`Untitled ${ids.untitled2}.md`]: {parent: markdownTests},
            // This is a child page inside a database row, so it keeps its parent
            [`Example sub-page ${ids.exampleSubPage}.md`]: {
                parent: `Click me to see even more detail ${ids.clickMeDetail}.md`,
            },
        });
    });

    test("nested export (JJ-Test-Nested.zip) - real export from Notion", async () => {
        const zip = readFixture("JJ-Test-Nested.zip");
        const result = assertResult(
            await parseNotionImportWithTestContext(zip, createTestNotionImportItem()),
        );

        const pp = "Page Parent";
        const tdl = "To Do List";
        const tl = `${tdl}/Todo List`;

        // Note: Home file is excluded because it only contains CSV links
        const docPaths = [
            `Empty ${ids.empty}.md`,
            `Page Parent ${ids.pageParent}.md`,
            `Getting Started ${ids.gettingStarted}.md`,
            `To Do List ${ids.toDoList}.md`,
            `Personal Website ${ids.personalWebsite}.md`,
            `Journal ${ids.journal}.md`,
            `${pp}/I’m a nested page ${ids.nestedPage}.md`,
            `${pp}/Database Page ${ids.databasePage}.md`,
            `${pp}/Markdown Tests ${ids.markdownTests}.md`,
            `${pp}/Tasks Tracker/Publish release notes ${ids.publishRelease}.md`,
            `${pp}/Tasks Tracker/Untitled ${ids.untitled1}.md`,
            `${pp}/Tasks Tracker/Improve website copy ${ids.improveWebsite}.md`,
            `${pp}/Tasks Tracker/Update help center & FAQ ${ids.updateHelp}.md`,
            `${tl}/Click me to see even more detail ${ids.clickMeDetail}.md`,
            `${tl}/Check the box to mark items as done ${ids.checkBox}.md`,
            `${tl}/Click me to learn how to hide checked items ${ids.hideChecked}.md`,
            `${tl}/Click me to learn how to see your content your way ${ids.seeContentYourWay}.md`,
            `${tl}/See finished items in the \u201CDone\u201D view ${ids.doneView}.md`,
            `${tl}/Click the blue New button to add a task ${ids.blueNewButton}.md`,
            `${tl}/Click the due date to change it ${ids.dueDateChange}.md`,
            `People/Josh Johnson ${ids.joshJohnson}.md`,
            `${pp}/I’m a nested page/I’m a double nested page ${ids.doubleNested}.md`,
            `${pp}/I’m a nested page/Another double nested page ${ids.anotherDoubleNested}.md`,
            `${pp}/Database Page/I’m an inline database/Inline 1 ${ids.inline1}.md`,
            `${pp}/Database Page/I’m an inline database/Inline 2 ${ids.inline2}.md`,
            `${pp}/Database Page/I’m an inline database/Inline 3 ${ids.inline3}.md`,
            `${pp}/I’m a full page database/Full Page 1 ${ids.fullPage1}.md`,
            `${pp}/I’m a full page database/Full Page 2 ${ids.fullPage2}.md`,
            `${pp}/I’m a full page database/Full Page 3 ${ids.fullPage3}.md`,
            `${pp}/Markdown Tests/This is a database with a map view/Untitled ${ids.untitled2}.md`,
            `${tl}/Click me to see even more detail/Example sub-page ${ids.exampleSubPage}.md`,
        ];

        const filePaths = [
            "Personal Website/person.png",
            `${tl}/Click me to learn how to hide checked items/image.png`,
            `${tl}/Click me to learn how to hide checked items/image 1.png`,
            `${tl}/Click me to learn how to hide checked items/image 2.png`,
            `${tl}/Click me to learn how to see your content your way/image.png`,
            `${tl}/Click me to learn how to see your content your way/image 1.png`,
            `${tl}/Click me to learn how to see your content your way/image 2.png`,
            `${tl}/See finished items in the \u201CDone\u201D view/image.png`,
            `${pp}/I’m a nested page/Another double nested page/IMG_8627.jpg`,
            `${pp}/I’m a nested page/Another double nested page/IMG_7190.jpg`,
            `${pp}/I’m a full page database/Full Page 3/21p.mp4`,
        ];

        const nestedPagePath = `${pp}/I’m a nested page ${ids.nestedPage}.md`;
        const doubleNestedPath = `${pp}/I’m a nested page/I’m a double nested page ${ids.doubleNested}.md`;
        const anotherDoublePath = `${pp}/I’m a nested page/Another double nested page ${ids.anotherDoubleNested}.md`;

        const pageParent = `Page Parent ${ids.pageParent}.md`;
        const databasePage = `${pp}/Database Page ${ids.databasePage}.md`;
        const markdownTests = `${pp}/Markdown Tests ${ids.markdownTests}.md`;
        const toDoList = `To Do List ${ids.toDoList}.md`;

        // Note: Children of CSV-only inline databases do NOT have parent-child
        // relationships. They are only tracked in inlineDatabaseChildren for cell linking
        // in the table.
        assertResultWithAssertions(result, docPaths, filePaths, {
            [`Empty ${ids.empty}.md`]: {},
            [pageParent]: {
                // Only direct .md children, NOT children of CSV-only databases
                children: [nestedPagePath, databasePage, markdownTests],
                references: [nestedPagePath, databasePage, markdownTests],
            },
            [`Getting Started ${ids.gettingStarted}.md`]: {
                references: [nestedPagePath],
            },
            // To Do List has an inline database - its children don't appear here
            [toDoList]: {},
            [`Personal Website ${ids.personalWebsite}.md`]: {
                files: ["Personal Website/person.png"],
            },
            [`Journal ${ids.journal}.md`]: {},
            [nestedPagePath]: {
                parent: pageParent,
                children: [doubleNestedPath, anotherDoublePath],
                references: [
                    doubleNestedPath,
                    anotherDoublePath,
                    `Getting Started ${ids.gettingStarted}.md`,
                ],
            },
            // Database Page has an inline database - its children don't appear here
            [databasePage]: {
                parent: pageParent,
            },
            // Markdown Tests has an inline database - its children don't appear here
            [markdownTests]: {
                parent: pageParent,
                references: [`Getting Started ${ids.gettingStarted}.md`],
            },
            // Children of CSV-only databases have parent = grandparent
            [`${pp}/Tasks Tracker/Publish release notes ${ids.publishRelease}.md`]: {
                parent: pageParent,
            },
            [`${pp}/Tasks Tracker/Untitled ${ids.untitled1}.md`]: {parent: pageParent},
            [`${pp}/Tasks Tracker/Improve website copy ${ids.improveWebsite}.md`]: {
                parent: pageParent,
            },
            [`${pp}/Tasks Tracker/Update help center & FAQ ${ids.updateHelp}.md`]: {
                parent: pageParent,
            },
            // These are children of a CSV-only database inside To Do List
            [`${tl}/Click me to see even more detail ${ids.clickMeDetail}.md`]: {
                parent: toDoList,
                // This doc has a child page
                children: [
                    `${tl}/Click me to see even more detail/Example sub-page ${ids.exampleSubPage}.md`,
                ],
                references: [
                    `${tl}/Click me to see even more detail/Example sub-page ${ids.exampleSubPage}.md`,
                ],
            },
            [`${tl}/Check the box to mark items as done ${ids.checkBox}.md`]: {parent: toDoList},
            [`${tl}/Click me to learn how to hide checked items ${ids.hideChecked}.md`]: {
                parent: toDoList,
                files: [
                    `${tl}/Click me to learn how to hide checked items/image.png`,
                    `${tl}/Click me to learn how to hide checked items/image 1.png`,
                    `${tl}/Click me to learn how to hide checked items/image 2.png`,
                ],
            },
            [`${tl}/Click me to learn how to see your content your way ${ids.seeContentYourWay}.md`]:
                {
                    parent: toDoList,
                    files: [
                        `${tl}/Click me to learn how to see your content your way/image.png`,
                        `${tl}/Click me to learn how to see your content your way/image 1.png`,
                        `${tl}/Click me to learn how to see your content your way/image 2.png`,
                    ],
                },
            [`${tl}/See finished items in the \u201CDone\u201D view ${ids.doneView}.md`]: {
                parent: toDoList,
                files: [`${tl}/See finished items in the \u201CDone\u201D view/image.png`],
            },
            [`${tl}/Click the blue New button to add a task ${ids.blueNewButton}.md`]: {
                parent: toDoList,
            },
            [`${tl}/Click the due date to change it ${ids.dueDateChange}.md`]: {parent: toDoList},
            [`People/Josh Johnson ${ids.joshJohnson}.md`]: {},
            [doubleNestedPath]: {
                parent: nestedPagePath,
            },
            [anotherDoublePath]: {
                parent: nestedPagePath,
                files: [
                    `${pp}/I’m a nested page/Another double nested page/IMG_8627.jpg`,
                    `${pp}/I’m a nested page/Another double nested page/IMG_7190.jpg`,
                ],
            },
            // Children of inline database in Database Page - parent is grandparent
            [`${pp}/Database Page/I’m an inline database/Inline 1 ${ids.inline1}.md`]: {
                parent: databasePage,
            },
            [`${pp}/Database Page/I’m an inline database/Inline 2 ${ids.inline2}.md`]: {
                parent: databasePage,
            },
            [`${pp}/Database Page/I’m an inline database/Inline 3 ${ids.inline3}.md`]: {
                parent: databasePage,
            },
            // Children of CSV-only "Full Page" database - parent is grandparent
            [`${pp}/I’m a full page database/Full Page 1 ${ids.fullPage1}.md`]: {
                parent: pageParent,
            },
            [`${pp}/I’m a full page database/Full Page 2 ${ids.fullPage2}.md`]: {
                parent: pageParent,
            },
            [`${pp}/I’m a full page database/Full Page 3 ${ids.fullPage3}.md`]: {
                parent: pageParent,
                files: [`${pp}/I’m a full page database/Full Page 3/21p.mp4`],
            },
            // Child of inline database in Markdown Tests - parent is grandparent
            [`${pp}/Markdown Tests/This is a database with a map view/Untitled ${ids.untitled2}.md`]:
                {
                    parent: markdownTests,
                },
            // This is a child page inside a database row, so it keeps its parent
            [`${tl}/Click me to see even more detail/Example sub-page ${ids.exampleSubPage}.md`]: {
                parent: `${tl}/Click me to see even more detail ${ids.clickMeDetail}.md`,
            },
        });
    });

    // Workspace fixture IDs
    const wsIds = {
        home: "20f0533fd9894bc5a3171c9f0fae517e",
        gettingStarted: "2f178915cb0e8089adbcdf928f9ddebf",
        toDoList: "2f178915cb0e80f6b710fc5e9047f5cd",
        checkBox: "2f178915cb0e8019a010f70508fb20bb",
        seeContentYourWay: "2f178915cb0e8085b15ecaaabe89581a",
        dueDateChange: "2f178915cb0e8091bfb5cf3616470ed6",
        hideChecked: "2f178915cb0e809788c1fb9b3f4803da",
        blueNewButton: "2f178915cb0e80a68283d2925fd9691b",
        doneView: "2f178915cb0e80b0978cce4d38648bb8",
        clickMeDetail: "2f178915cb0e80c8a5cde5c544bf54c7",
        exampleSubPage: "2f178915cb0e808cb181e49a5992a268",
        scratchpad: "2f178915cb0e81d287e9cf58209f69ff",
        oneOnOneNotes: "2f178915cb0e81fba816eca18aea475b",
        calebMeredith: "4fd78915cb0e829ea01c816d52f792c3",
        joshJohnson: "d6078915cb0e8255b8e181fe267cea1b",
        alpine: "2f178915cb0e809e9fe9f7830269517f",
        workspacePage: "2f178915cb0e80d5b12be1c072904fe4",
    };

    const privateTeamspaceId = "Private&Shared";
    const calebTeamspaceId = "2f178915cb0e81b2b9c90042322642ab";

    // Note: Home file is excluded because it only contains CSV links
    const flatPrivateDocs = [
        `Getting Started ${wsIds.gettingStarted}.md`,
        `To Do List ${wsIds.toDoList}.md`,
        `Check the box to mark items as done ${wsIds.checkBox}.md`,
        `Click me to learn how to see your content your way ${wsIds.seeContentYourWay}.md`,
        `Click the due date to change it ${wsIds.dueDateChange}.md`,
        `Click me to learn how to hide checked items ${wsIds.hideChecked}.md`,
        `Click the blue New button to add a task ${wsIds.blueNewButton}.md`,
        `See finished items in the \u201CDone\u201D view ${wsIds.doneView}.md`,
        `Click me to see even more detail ${wsIds.clickMeDetail}.md`,
        `Example sub-page ${wsIds.exampleSubPage}.md`,
        `Scratchpad ${wsIds.scratchpad}.md`,
        `1 1 notes ${wsIds.oneOnOneNotes}.md`,
        `Caleb Meredith ${wsIds.calebMeredith}.md`,
        `Josh Johnson ${wsIds.joshJohnson}.md`,
    ];

    const flatCalebDocs = [
        `Alpine ${wsIds.alpine}.md`,
        `I’m a workspace page! ${wsIds.workspacePage}.md`,
    ];

    test("Workspace-Flat.zip with Private&Shared as Private", async () => {
        const zip = readFixture("Workspace-Flat.zip");
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTeamspaceId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                    {
                        teamspaceId: calebTeamspaceId,
                        teamspaceName: "Caleb",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(Object.keys(docs).sort()).toEqual([...flatPrivateDocs, ...flatCalebDocs].sort());

        const privateTs = result.teamspaces.find(ts => ts.id === privateTeamspaceId)!;
        expect(privateTs.importOption).toEqual({type: "Private"});
        for (const path of flatPrivateDocs) {
            expect(privateTs.documents[path]).toBeDefined();
        }

        const calebTs = result.teamspaces.find(ts => ts.id === calebTeamspaceId)!;
        expect(calebTs.importOption).toEqual({type: "Public"});
        for (const path of flatCalebDocs) {
            expect(calebTs.documents[path]).toBeDefined();
        }
    });

    test("Workspace-Flat.zip with Private&Shared as DoNotImport", async () => {
        const zip = readFixture("Workspace-Flat.zip");
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTeamspaceId,
                        teamspaceName: "Private",
                        option: {type: "DoNotImport"},
                    },
                    {
                        teamspaceId: calebTeamspaceId,
                        teamspaceName: "Caleb",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(Object.keys(docs).sort()).toEqual(flatCalebDocs.sort());

        // Private teamspace should not appear in results
        const privateTs = result.teamspaces.find(ts => ts.id === privateTeamspaceId);
        expect(privateTs).toBeUndefined();

        const calebTs = result.teamspaces.find(ts => ts.id === calebTeamspaceId)!;
        expect(calebTs.importOption).toEqual({type: "Public"});
        for (const path of flatCalebDocs) {
            expect(calebTs.documents[path]).toBeDefined();
        }
    });

    test("Workspace-Nested.zip with Private&Shared as Private", async () => {
        const zip = readFixture("Workspace-Nested.zip");

        const ps = "Private & Shared";
        const tl = `${ps}/To Do List/Todo List`;
        const csHq = "Caleb Meredith’s Space HQ/2f178915cb0e81b2b9c90042322642ab";

        // Note: Home file is excluded because it only contains CSV links
        const nestedPrivateDocs = [
            `${ps}/Getting Started ${wsIds.gettingStarted}.md`,
            `${ps}/To Do List ${wsIds.toDoList}.md`,
            `${tl}/Check the box to mark items as done ${wsIds.checkBox}.md`,
            `${tl}/Click me to learn how to see your content your way ${wsIds.seeContentYourWay}.md`,
            `${tl}/Click the due date to change it ${wsIds.dueDateChange}.md`,
            `${tl}/Click me to learn how to hide checked items ${wsIds.hideChecked}.md`,
            `${tl}/Click the blue New button to add a task ${wsIds.blueNewButton}.md`,
            `${tl}/See finished items in the \u201CDone\u201D view ${wsIds.doneView}.md`,
            `${tl}/Click me to see even more detail ${wsIds.clickMeDetail}.md`,
            `${tl}/Click me to see even more detail/Example sub-page ${wsIds.exampleSubPage}.md`,
            `${ps}/Scratchpad ${wsIds.scratchpad}.md`,
            `${ps}/1 1 notes ${wsIds.oneOnOneNotes}.md`,
            `${ps}/People/Caleb Meredith ${wsIds.calebMeredith}.md`,
            `${ps}/People/Josh Johnson ${wsIds.joshJohnson}.md`,
        ];

        const nestedCalebDocs = [
            `${csHq}/Alpine ${wsIds.alpine}.md`,
            `${csHq}/Alpine/I’m a workspace page! ${wsIds.workspacePage}.md`,
        ];

        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTeamspaceId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                    {
                        teamspaceId: calebTeamspaceId,
                        teamspaceName: "Caleb",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(Object.keys(docs).sort()).toEqual([...nestedPrivateDocs, ...nestedCalebDocs].sort());

        const privateTs = result.teamspaces.find(ts => ts.id === privateTeamspaceId)!;
        expect(privateTs.importOption).toEqual({type: "Private"});
        for (const path of nestedPrivateDocs) {
            expect(privateTs.documents[path]).toBeDefined();
        }

        const calebTs = result.teamspaces.find(ts => ts.id === calebTeamspaceId)!;
        expect(calebTs.importOption).toEqual({type: "Public"});
        for (const path of nestedCalebDocs) {
            expect(calebTs.documents[path]).toBeDefined();
        }
    });
});

describe("teamspace filtering", () => {
    test("Private teamspace documents are grouped under Private teamspace", async () => {
        const page1 = new ExportedNotionDocument("Home", "welcome");
        const page2 = new ExportedNotionDocument("Notes", "notes content");
        const page3 = new ExportedNotionDocument("Projects", "project list");

        const privateTs = new ExportedNotionTeamspace("Private & Shared", [page1, page2]);
        const publicTs = new ExportedNotionTeamspace("Josh's Space HQ", [page3]);

        const zip = createTestNotionImportZip([privateTs, publicTs]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTs.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                    {
                        teamspaceId: publicTs.notionId,
                        teamspaceName: "Public",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const privateTsResult = result.teamspaces.find(ts => ts.id === privateTs.notionId)!;
        expect(privateTsResult.importOption).toEqual({type: "Private"});
        expect(privateTsResult.documents[`Home ${page1.notionId}.md`]).toBeDefined();
        expect(privateTsResult.documents[`Notes ${page2.notionId}.md`]).toBeDefined();
    });

    test("Public teamspace documents are grouped under Public teamspace", async () => {
        const page1 = new ExportedNotionDocument("Home", "");
        const page2 = new ExportedNotionDocument("Projects", "");

        const privateTs = new ExportedNotionTeamspace("Private & Shared", [page1]);
        const publicTs = new ExportedNotionTeamspace("Josh's Space HQ", [page2]);

        const zip = createTestNotionImportZip([privateTs, publicTs]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTs.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                    {
                        teamspaceId: publicTs.notionId,
                        teamspaceName: "Public",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const publicTsResult = result.teamspaces.find(ts => ts.id === publicTs.notionId)!;
        expect(publicTsResult.importOption).toEqual({type: "Public"});
        expect(publicTsResult.documents[`Projects ${page2.notionId}.md`]).toBeDefined();
    });

    test("DoNotImport teamspace documents are excluded from result", async () => {
        const page1 = new ExportedNotionDocument("Secret", "secret content");
        const page2 = new ExportedNotionDocument("Public Page", "visible");

        const doNotImportTs = new ExportedNotionTeamspace("Private & Shared", [page1]);
        const publicTs = new ExportedNotionTeamspace("Josh's Space HQ", [page2]);

        const zip = createTestNotionImportZip([doNotImportTs, publicTs]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: doNotImportTs.notionId,
                        teamspaceName: "Private",
                        option: {type: "DoNotImport"},
                    },
                    {
                        teamspaceId: publicTs.notionId,
                        teamspaceName: "Public",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(docs[`Secret ${page1.notionId}.md`]).toBeUndefined();
        expect(docs[`Public Page ${page2.notionId}.md`]).toBeDefined();

        const excludedTsResult = result.teamspaces.find(ts => ts.id === doNotImportTs.notionId);
        expect(excludedTsResult).toBeUndefined();
    });

    test("nested documents are grouped under same teamspace as parent", async () => {
        const child = new ExportedNotionDocument("Child", "child content");
        const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
        const publicPage = new ExportedNotionDocument("Open", "open content");

        const privateTs = new ExportedNotionTeamspace("Private & Shared", [parent]);
        const publicTs = new ExportedNotionTeamspace("Josh's Space HQ", [publicPage]);

        const zip = createTestNotionImportZip([privateTs, publicTs]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: privateTs.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                    {
                        teamspaceId: publicTs.notionId,
                        teamspaceName: "Public",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const privateTsResult = result.teamspaces.find(ts => ts.id === privateTs.notionId)!;
        expect(privateTsResult.documents[`Parent ${parent.notionId}.md`]).toBeDefined();
        expect(privateTsResult.documents[`Child ${child.notionId}.md`]).toBeDefined();

        const publicTsResult = result.teamspaces.find(ts => ts.id === publicTs.notionId)!;
        expect(publicTsResult.documents[`Open ${publicPage.notionId}.md`]).toBeDefined();
    });

    test("DoNotImport excludes nested documents too", async () => {
        const child = new ExportedNotionDocument("Nested Secret", "");
        const parent = new ExportedNotionDocument("Secret Parent", "", [child]);
        const publicPage = new ExportedNotionDocument("Visible", "");

        const excludedTs = new ExportedNotionTeamspace("Private & Shared", [parent]);
        const publicTs = new ExportedNotionTeamspace("Josh's Space HQ", [publicPage]);

        const zip = createTestNotionImportZip([excludedTs, publicTs]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: excludedTs.notionId,
                        teamspaceName: "Private",
                        option: {type: "DoNotImport"},
                    },
                    {
                        teamspaceId: publicTs.notionId,
                        teamspaceName: "Public",
                        option: {type: "Public"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(docs[`Secret Parent ${parent.notionId}.md`]).toBeUndefined();
        expect(docs[`Nested Secret ${child.notionId}.md`]).toBeUndefined();
        expect(docs[`Visible ${publicPage.notionId}.md`]).toBeDefined();
    });
});

describe("Home file filtering", () => {
    test("Home file with only CSV links at teamspace root is excluded", async () => {
        // Create a Home file that only has CSV links (should be filtered). Use raw CSV
        // link syntax since we don't need real CSV files in the zip.
        const homeWithCsvOnly = new ExportedNotionDocument(
            "Home",
            "[Tasks](Tasks%20abc123.csv)\n\n[My tasks](My%20tasks%20def456.csv)",
        );
        const otherPage = new ExportedNotionDocument("Notes", "some content");

        const teamspace = new ExportedNotionTeamspace("Private", [homeWithCsvOnly, otherPage]);
        const zip = createTestNotionImportZip([teamspace]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: teamspace.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(docs[`Home ${homeWithCsvOnly.notionId}.md`]).toBeUndefined();
        expect(docs[`Notes ${otherPage.notionId}.md`]).toBeDefined();
    });

    test("Home file with real content at teamspace root is NOT excluded", async () => {
        // Create a Home file with real content (should NOT be filtered)
        const homeWithContent = new ExportedNotionDocument(
            "Home",
            "Welcome to our workspace!\n\nThis is the home page.",
        );
        const otherPage = new ExportedNotionDocument("Notes", "some content");

        const teamspace = new ExportedNotionTeamspace("Private", [homeWithContent, otherPage]);
        const zip = createTestNotionImportZip([teamspace]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: teamspace.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(docs[`Home ${homeWithContent.notionId}.md`]).toBeDefined();
        expect(docs[`Notes ${otherPage.notionId}.md`]).toBeDefined();
    });

    test("nested Home document is NOT excluded even if it only has CSV links", async () => {
        // Create a nested Home file (should NOT be filtered, even if CSV-only)
        const nestedHome = new ExportedNotionDocument(
            "Home",
            "[Tasks](tasks.csv)\n\n[Other](other.csv)",
        );
        const parent = new ExportedNotionDocument("Parent", "parent content", [nestedHome]);
        const otherPage = new ExportedNotionDocument("Notes", "some content");

        const teamspace = new ExportedNotionTeamspace("Private", [parent, otherPage]);
        const zip = createTestNotionImportZip([teamspace]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: teamspace.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        // The nested Home should be imported because it has a parent
        expect(docs[`Home ${nestedHome.notionId}.md`]).toBeDefined();
        expect(docs[`Parent ${parent.notionId}.md`]).toBeDefined();
        expect(docs[`Notes ${otherPage.notionId}.md`]).toBeDefined();
    });

    test("Home file with mixed content (CSV and real text) is NOT excluded", async () => {
        // Create a Home file with both CSV links and real content (should NOT be filtered)
        const homeWithMixedContent = new ExportedNotionDocument(
            "Home",
            "[Tasks](tasks.csv)\n\nWelcome to our workspace! Check out the tasks above.",
        );
        const otherPage = new ExportedNotionDocument("Notes", "some content");

        const teamspace = new ExportedNotionTeamspace("Private", [homeWithMixedContent, otherPage]);
        const zip = createTestNotionImportZip([teamspace]);
        const result = assertResult(
            await parseNotionImportWithTestContext(
                zip,
                createTestNotionImportItem([
                    {
                        teamspaceId: teamspace.notionId,
                        teamspaceName: "Private",
                        option: {type: "Private"},
                    },
                ]),
            ),
        );

        const docs = getAllDocuments(result);
        expect(docs[`Home ${homeWithMixedContent.notionId}.md`]).toBeDefined();
        expect(docs[`Notes ${otherPage.notionId}.md`]).toBeDefined();
    });
});
