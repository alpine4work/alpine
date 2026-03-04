import {readFileSync} from "fs";
import {join} from "path";

import {getDocument, getDocumentsTableForTest} from "~/server/documents/data/documents_actions.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {processStartNotionImportJob} from "~/server/importer/notion/process_start_notion_import_job.js";
import {
    ExportedNotionDatabase,
    ExportedNotionDocument,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    // Inject search so mentions can be resolved when getting documents
    searchInjection: {
        getSearchMentionEntityIfPossible: async () => null,
    },
});

/**
 * Create a system action context with a fresh importer module containing the given
 * file.
 */
function createSystemActionWithFile(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    importKey: string,
    fileData?: Uint8Array,
) {
    const importer = new TestImporterContextModule();
    if (fileData) {
        importer.setUploadedFile(importKey, fileData);
    }

    return context.cloneWithHelpers({
        tracer: new TracerContextModule(context.tracer.getTracer()),
        cache: CacheContextModule.new(),
        batch: BatchContextModule.new(),
        actor: SystemActorContextModule.dangerouslyNew("Test", space.id),
        importer,
        importerService: importer.createServiceModule(),
    });
}

function readFixture(name: string): Uint8Array {
    const runfiles = assertExists(process.env.RUNFILES, "RUNFILES environment variable not set");
    const fixturePath = join(runfiles, "cyberworlds", "server/importer/notion/test_fixtures", name);

    try {
        return new Uint8Array(readFileSync(fixturePath));
    } catch (error) {
        // Fallback to source directory for large fixtures not included in BUILD This uses
        // BUILD_WORKSPACE_DIRECTORY which points to the original source tree
        const workspaceDir = process.env.BUILD_WORKSPACE_DIRECTORY;
        if (workspaceDir) {
            const localPath = join(workspaceDir, "server/importer/notion/test_fixtures", name);
            return new Uint8Array(readFileSync(localPath));
        }

        throw error;
    }
}

/**
 * Find all documents in a space by scanning the documents table. This is expensive
 * but fine for tests.
 */
async function findDocumentsInSpace(
    spaceId: SpaceId,
): Promise<Array<{id: DocumentId; title: string}>> {
    const DocumentsTable = getDocumentsTableForTest();
    const docs: Array<{id: DocumentId; title: string}> = [];

    for await (const item of DocumentsTable.expensiveScan(context, {
        segmentIndex: 0,
        totalSegmentCount: 1,
        filter: [{partitionType: "Document", sortRangeType: "Attributes"}],
    })) {
        if (
            item.partitionType === "Document" &&
            item.sortRangeType === "Attributes" &&
            item.spaceId === spaceId
        ) {
            docs.push({id: item.documentId, title: item.titleWithoutFallback});
        }
    }

    return docs;
}

/**
 * Find a document by title in a space.
 */
async function findDocumentByTitle(
    spaceId: SpaceId,
    title: string,
): Promise<{id: DocumentId; title: string} | undefined> {
    const docs = await findDocumentsInSpace(spaceId);
    return docs.find(doc => doc.title === title);
}

async function importedFixtureSpaceItemsToString(
    space: TestSpace,
    session: TestSession,
    fixtureName: string,
) {
    const zip = readFixture(fixtureName);

    const notionImportId = generateId<NotionImportId>();
    const importKey = `${space.id}/Notion/${notionImportId}`;

    await NotionImporterTable.createItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
        spaceId: space.id,
        startedByAccountId: session.account.id,
        workspaceName: "Export",
        importKey,
        createdTime: new Date(),
        updatedTime: new Date(),
        teamspaceImportOptions: null,
        status: {type: "ProcessQueued"},
        importedCount: 0,
        importZipSize: 1024,
    });

    await processStartNotionImportJob(
        createSystemActionWithFile(space, importKey, zip),
        notionImportId,
    );

    // Get all documents
    const allDocs = await findDocumentsInSpace(space.id);

    // Fetch full documents to get parent info for sorting
    const docContents = new Map<DocumentId, ReturnType<typeof JSON.parse>>();
    for (const doc of allDocs) {
        const fullDoc = await getDocument(space.systemAction(), doc.id);
        docContents.set(doc.id, fullDoc.content.doc.toJSON());
    }

    // Build ID to title map for parent lookup
    const idToTitle = new Map<DocumentId, string>();
    for (const doc of allDocs) {
        idToTitle.set(doc.id, doc.title);
    }

    // Helper to extract parent title from document content
    const getParentTitle = (content: ReturnType<typeof JSON.parse>): string => {
        for (const node of content.content || []) {
            if (node.type === "paragraph" && node.content) {
                // Check if this is a "Parent document:" paragraph
                const hasParentText = node.content.some(
                    (c: any) => c.type === "text" && c.text === "Parent document: ",
                );
                if (hasParentText) {
                    // Look for the mention node with the parent document ID
                    const mentionNode = node.content.find(
                        (c: any) => c.type === "mention" && c.attrs?.mention?.entityId,
                    );
                    if (mentionNode) {
                        // entityId format is "Document:abc123"
                        const docId = mentionNode.attrs.mention.entityId.replace(
                            "Document:",
                            "",
                        ) as DocumentId;
                        return idToTitle.get(docId) ?? "";
                    }
                }
            }
        }
        return "";
    };

    // Sort by title, then by parent title for deterministic ordering
    allDocs.sort((a, b) => {
        const titleCmp = a.title.localeCompare(b.title);
        if (titleCmp !== 0) return titleCmp;
        const parentA = getParentTitle(docContents.get(a.id));
        const parentB = getParentTitle(docContents.get(b.id));
        return parentA.localeCompare(parentB);
    });

    // Build map of document ID -> unique key for sanitization Handle duplicate titles
    // by adding an index suffix
    const idToKey = new Map<DocumentId, string>();
    const titleCounts = new Map<string, number>();
    for (const doc of allDocs) {
        const count = titleCounts.get(doc.title) ?? 0;
        const key = count === 0 ? doc.title : `${doc.title} (${count + 1})`;
        idToKey.set(doc.id, key);
        titleCounts.set(doc.title, count + 1);
    }

    // Build map of unique key -> content.toJSON()
    const contentMap: Record<string, unknown> = {};
    for (const doc of allDocs) {
        const key = idToKey.get(doc.id)!;
        contentMap[key] = docContents.get(doc.id);
    }

    // Sanitize dynamic IDs in the content
    let contentString = JSON.stringify(contentMap, null, 2);

    // Replace space ID with placeholder
    contentString = contentString.replace(new RegExp(space.id, "g"), "<SPACE_ID>");

    // Replace document IDs with placeholders based on their unique keys
    for (const [id, key] of idToKey) {
        contentString = contentString.replace(new RegExp(id, "g"), `<DOC_ID:${key}>`);
    }

    // Replace account ID with placeholder
    contentString = contentString.replace(new RegExp(session.account.id, "g"), "<ACCOUNT_ID>");

    // Normalize file URLs to just filenames for comparison. Flat exports have files at
    // root (e.g., image.png), nested exports have files in subdirectories (e.g.,
    // Subdir/image.png). Since file uploads aren't implemented yet, we normalize to
    // just the filename to allow comparison.
    contentString = contentString.replace(
        /"url":\s*"([^"]+\.(png|jpg|jpeg|gif|mp4|mov|csv|pdf))"/gi,
        (match, url) => {
            const decoded = decodeURIComponent(url);
            const filename = decoded.split("/").pop()!;
            // eslint-disable-next-line cyberworlds/string-quotes -- JSON format requires straight quotes
            return `"url": "${encodeURIComponent(filename)}"`;
        },
    );

    return contentString;
}

/**
 * Create the expected mention node structure for a document. Mention URLs are now
 * parsed into mention nodes by the markdown parser.
 */
function documentMentionNode(documentId: DocumentId) {
    return {
        type: "mention",
        attrs: {
            mention: {
                type: "SearchEntity",
                entityId: `Document:${documentId}`,
            },
        },
    };
}

describe("processStartNotionImportJob", () => {
    beforeEach(() => {
        import.meta.jest.useFakeTimers();
        // Set a fixed date for consistent snapshot testing
        import.meta.jest.setSystemTime(new Date("2026-01-28T12:00:00.000Z"));
    });

    afterEach(() => {
        import.meta.jest.useRealTimers();
    });

    describe("with test framework zips", () => {
        test("imports a simple document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Hello World", "This is my content.");
            const zip = createTestNotionImportZip([doc]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            // Set up the import record
            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            // Process the import
            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            // Verify the import succeeded
            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});
            expect(importItem.importedCount).toBe(1);
        });

        test("imports document with inline database as table", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create an inline database
            const inlineDb = new ExportedNotionDatabase("Team Members", [
                ["Name", "Role"],
                ["Alice", "Engineer"],
                ["Bob", "Designer"],
            ]);

            // Create parent document that references the database inline
            const parentDoc = new ExportedNotionDocument(
                "Team Overview",
                `Here is our team:\n\n${inlineDb.toCsvReference()}`,
                [inlineDb],
            );

            const zip = createTestNotionImportZip([parentDoc]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});

            // The inline database should NOT create a separate document. Only the parent
            // document should be created.
            expect(importItem.importedCount).toBe(1);
        });

        test("inline database children have parent link to grandparent", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create child documents for the inline database
            const aliceDoc = new ExportedNotionDocument("Alice", "Alice profile");
            const bobDoc = new ExportedNotionDocument("Bob", "Bob profile");

            // Create an inline database (CSV-only) with children
            const database = new ExportedNotionDatabase(
                "Team",
                [
                    ["Name", "Role"],
                    ["Alice", "Engineer"],
                    ["Bob", "Designer"],
                ],
                [aliceDoc, bobDoc],
                {inline: true},
            );

            // Parent document references the database inline
            const parent = new ExportedNotionDocument(
                "Project",
                `Team members:\n\n${database.toCsvReference()}`,
                [database],
            );

            const zip = createTestNotionImportZip([parent]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});
            // Parent document + Alice + Bob = 3 documents (inline database itself is excluded)
            expect(importItem.importedCount).toBe(3);

            // Find the documents
            const parentDocInfo = await findDocumentByTitle(space.id, "Project");
            const aliceDocInfo = await findDocumentByTitle(space.id, "Alice");
            const bobDocInfo = await findDocumentByTitle(space.id, "Bob");

            expect(parentDocInfo).toBeDefined();
            expect(aliceDocInfo).toBeDefined();
            expect(bobDocInfo).toBeDefined();

            // Find the teamspace root document (created when importing without explicit
            // teamspace)
            const teamspaceRootDoc = await findDocumentByTitle(space.id, "Test Workspace");
            expect(teamspaceRootDoc).toBeDefined();

            // Helper to create the expected table with cell mentions
            const expectedTable = {
                type: "table",
                attrs: {
                    columnWidths: [1, 1],
                    tableWidth: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                },
                content: [
                    // Header row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Name"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Role"}]},
                                ],
                            },
                        ],
                    },
                    // Alice row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [documentMentionNode(aliceDocInfo!.id)],
                                    },
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [{type: "text", text: "Engineer"}],
                                    },
                                ],
                            },
                        ],
                    },
                    // Bob row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [documentMentionNode(bobDocInfo!.id)],
                                    },
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [{type: "text", text: "Designer"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            // Verify parent document "Project" - full content assertion Note: The inline
            // database table appears twice - once at the top (after parent link) and once
            // where the CSV reference was in the original markdown
            const parentDocument = await getDocument(space.systemAction(), parentDocInfo!.id);
            const parentContent = parentDocument.content.doc.toJSON();

            expect(parentContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Project"}]},
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(teamspaceRootDoc!.id),
                        ],
                    },
                    expectedTable,
                    {type: "divider"},
                    {type: "paragraph", content: [{type: "text", text: "Team members:"}]},
                    expectedTable,
                ],
            });

            // Verify Alice document "Alice" - full content assertion
            const aliceDocument = await getDocument(space.systemAction(), aliceDocInfo!.id);
            const aliceContent = aliceDocument.content.doc.toJSON();

            expect(aliceContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Alice"}]},
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(parentDocInfo!.id),
                        ],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Alice profile"}]},
                ],
            });

            // Verify Bob document "Bob" - full content assertion
            const bobDocument = await getDocument(space.systemAction(), bobDocInfo!.id);
            const bobContent = bobDocument.content.doc.toJSON();

            expect(bobContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Bob"}]},
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(parentDocInfo!.id),
                        ],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Bob profile"}]},
                ],
            });
        });

        test("root-level CSV database creates document with table cell links", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create child documents for a root-level CSV-only database
            const meeting1 = new ExportedNotionDocument(
                "Weekly - July 6, 2025",
                "Discussion of Q3 goals",
            );
            const meeting2 = new ExportedNotionDocument(
                "Standup - July 7, 2025",
                "Daily sync meeting",
            );

            // Create a root-level CSV-only database (inline mode, no .md wrapper)
            const meetingDb = new ExportedNotionDatabase(
                "MTG Notes",
                [
                    ["Title", "Date", "Attendees"],
                    ["Weekly - July 6, 2025", "2025-07-06", "Team"],
                    ["Standup - July 7, 2025", "2025-07-07", "All"],
                    ["Retro", "2025-07-08", "Engineering"], // No matching child doc
                ],
                [meeting1, meeting2],
                {inline: true}, // CSV-only, no .md wrapper
            );

            // Also create a regular document at root level
            const homeDoc = new ExportedNotionDocument("Home", "Welcome to the workspace");

            // Create with teamspace
            const teamspace = new ExportedNotionTeamspace("Engineering", [meetingDb, homeDoc]);
            const zip = createTestNotionImportZip([teamspace]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});

            // Find all the documents created
            const allDocs = await findDocumentsInSpace(space.id);
            const docTitles = allDocs.map(d => d.title).sort();

            // Should have: Teamspace root, MTG Notes db doc, Home, Weekly, Standup = 5
            // documents The teamspace root title is "Test Workspace | Engineering"
            expect(docTitles).toContain("Home");
            expect(docTitles).toContain("MTG Notes");
            expect(docTitles).toContain("Weekly - July 6, 2025");
            expect(docTitles).toContain("Standup - July 7, 2025");
            expect(docTitles).toContain("Test Workspace | Engineering");
            // importedCount only counts user documents, not the teamspace root doc Home + MTG
            // Notes db doc + Weekly + Standup = 4
            expect(importItem.importedCount).toBe(4);

            // Find all the documents
            const mtgNotesDoc = await findDocumentByTitle(space.id, "MTG Notes");
            const homeDocInfo = await findDocumentByTitle(space.id, "Home");
            const meeting1Doc = await findDocumentByTitle(space.id, "Weekly - July 6, 2025");
            const meeting2Doc = await findDocumentByTitle(space.id, "Standup - July 7, 2025");

            expect(mtgNotesDoc).toBeDefined();
            expect(homeDocInfo).toBeDefined();
            expect(meeting1Doc).toBeDefined();
            expect(meeting2Doc).toBeDefined();

            // Find the teamspace root document
            const teamspaceRootDoc = await findDocumentByTitle(
                space.id,
                "Test Workspace | Engineering",
            );
            expect(teamspaceRootDoc).toBeDefined();

            // Verify MTG Notes database document - full content assertion
            const mtgNotesFullDoc = await getDocument(space.systemAction(), mtgNotesDoc!.id);
            const mtgNotesContent = mtgNotesFullDoc.content.doc.toJSON();

            expect(mtgNotesContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "MTG Notes"}]},
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(teamspaceRootDoc!.id),
                        ],
                    },
                    {
                        type: "table",
                        attrs: {
                            columnWidths: [1, 1, 1],
                            tableWidth: 1,
                            hasHeaderRow: true,
                            hasHeaderColumn: false,
                        },
                        content: [
                            // Header row
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Title"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Date"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Attendees"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Weekly row with mention
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [documentMentionNode(meeting1Doc!.id)],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "2025-07-06"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Team"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Standup row with mention
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [documentMentionNode(meeting2Doc!.id)],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "2025-07-07"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "All"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Retro row without mention (plain text, no matching child doc)
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Retro"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "2025-07-08"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Engineering"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            // Verify Weekly meeting document - full content assertion
            const meeting1FullDoc = await getDocument(space.systemAction(), meeting1Doc!.id);
            const meeting1Content = meeting1FullDoc.content.doc.toJSON();

            expect(meeting1Content).toMatchObject({
                type: "doc",
                content: [
                    {
                        type: "title",
                        content: [{type: "text", text: "Weekly - July 6, 2025"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(mtgNotesDoc!.id),
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Discussion of Q3 goals"}],
                    },
                ],
            });

            // Verify Standup meeting document - full content assertion
            const meeting2FullDoc = await getDocument(space.systemAction(), meeting2Doc!.id);
            const meeting2Content = meeting2FullDoc.content.doc.toJSON();

            expect(meeting2Content).toMatchObject({
                type: "doc",
                content: [
                    {
                        type: "title",
                        content: [{type: "text", text: "Standup - July 7, 2025"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            documentMentionNode(mtgNotesDoc!.id),
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Daily sync meeting"}],
                    },
                ],
            });
        });

        test("root-level CSV database appears in teamspace root children", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create child documents for the database so it gets tracked
            const task1Doc = new ExportedNotionDocument("Task 1", "First task");

            // Create a root-level CSV-only database with a child
            const taskDb = new ExportedNotionDatabase(
                "Tasks",
                [
                    ["Name", "Status"],
                    ["Task 1", "Done"],
                ],
                [task1Doc], // Need at least one child for rootLevelCsvDatabases to be populated
                {inline: true},
            );

            // Create a regular document
            const designDoc = new ExportedNotionDocument("Design", "Design guidelines");

            // Create teamspace with both
            const teamspace = new ExportedNotionTeamspace("Engineering", [taskDb, designDoc]);
            const zip = createTestNotionImportZip([teamspace]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});

            // Find the teamspace root document
            const teamspaceRootDoc = await findDocumentByTitle(
                space.id,
                "Test Workspace | Engineering",
            );
            expect(teamspaceRootDoc).toBeDefined();

            // Find Tasks and Design documents
            const tasksDoc = await findDocumentByTitle(space.id, "Tasks");
            const designDocInfo = await findDocumentByTitle(space.id, "Design");

            expect(tasksDoc).toBeDefined();
            expect(designDocInfo).toBeDefined();

            // Get the teamspace root document
            const teamspaceRootFullDoc = await getDocument(
                space.systemAction(),
                teamspaceRootDoc!.id,
            );
            const teamspaceRootContent = teamspaceRootFullDoc.content.doc.toJSON();

            expect(teamspaceRootContent.type).toBe("doc");
            expect(teamspaceRootContent.content[0]).toEqual({
                type: "title",
                content: [{type: "text", text: "Test Workspace | Engineering"}],
            });

            // Find the "Documents" heading (teamspace root uses "Documents" not "Child
            // documents")
            const documentsHeading = teamspaceRootContent.content.find(
                (node: any) => node.type === "heading" && node.content?.[0]?.text === "Documents",
            );
            expect(documentsHeading).toBeDefined();

            // Find list items with mentions to Tasks and Design Mentions are now parsed as
            // mention nodes
            const listItems = teamspaceRootContent.content.filter(
                (node: any) => node.type === "unorderedListItem",
            );

            // Should have exactly 2 list items (Tasks and Design)
            expect(listItems.length).toBe(2);

            // Verify Tasks list item with mention node
            const tasksListItem = listItems.find((item: any) => {
                const paragraph = item.content?.[0];
                const mentionNode = paragraph?.content?.[0];
                return mentionNode?.attrs?.mention?.entityId === `Document:${tasksDoc!.id}`;
            });
            expect(tasksListItem).toEqual({
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [
                    {
                        type: "paragraph",
                        content: [documentMentionNode(tasksDoc!.id)],
                    },
                ],
            });

            // Verify Design list item with mention node
            const designListItem = listItems.find((item: any) => {
                const paragraph = item.content?.[0];
                const mentionNode = paragraph?.content?.[0];
                return mentionNode?.attrs?.mention?.entityId === `Document:${designDocInfo!.id}`;
            });
            expect(designListItem).toEqual({
                type: "unorderedListItem",
                attrs: {indent: 0},
                content: [
                    {
                        type: "paragraph",
                        content: [documentMentionNode(designDocInfo!.id)],
                    },
                ],
            });
        });

        test("imports document with teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const publicDoc = new ExportedNotionDocument("Public Page", "Public content");
            const privateDoc = new ExportedNotionDocument("Private Page", "Private content");

            const publicTs = new ExportedNotionTeamspace("Engineering", [publicDoc]);
            const privateTs = new ExportedNotionTeamspace("Private & Shared", [privateDoc]);

            const zip = createTestNotionImportZip([publicTs, privateTs]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});
            // 2 documents (one per teamspace) + 2 teamspace root documents
            expect(importItem.importedCount).toBeGreaterThanOrEqual(2);
        });

        /**
         * Helper to run a fixture file through the importer and return a sanitized
         * snapshot string of all document contents.
         *
         * Handles:
         *
         * - Deterministic ordering (by title, then by parent title for duplicates)
         * - Unique keys for documents with duplicate titles
         * - Sanitization of dynamic IDs (space, document, account)
         */
        function testFixtureSnapshot(fixtureName: string) {
            return async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const contentString = await importedFixtureSpaceItemsToString(
                    space,
                    session,
                    fixtureName,
                );

                expect(contentString).toMatchSnapshot();
            };
        }

        // Only snap one since we're asserting they're the same below
        test("Workspace-Flat.zip snapshot", testFixtureSnapshot("Workspace-Flat.zip"));
        test("Workspace-Flat.zip and Workspace-Nested.zip produce the same results", async () => {
            const space1 = await TestSpace.create(context);
            const session1 = await space1.createSession({role: "Admin"});
            const flat = await importedFixtureSpaceItemsToString(
                space1,
                session1,
                "Workspace-Flat.zip",
            );

            const space2 = await TestSpace.create(context);
            const session2 = await space2.createSession({role: "Admin"});
            const nested = await importedFixtureSpaceItemsToString(
                space2,
                session2,
                "Workspace-Nested.zip",
            );

            expect(flat).toBe(nested);
        });

        // Only snap one since we're asserting they're the same below
        test("JJ-Test-Flat.zip snapshot", testFixtureSnapshot("JJ-Test-Flat.zip"));
        test("JJ-Test-Flat.zip and JJ-Test-Nested.zip produce the same results", async () => {
            const space1 = await TestSpace.create(context);
            const session1 = await space1.createSession({role: "Admin"});
            const flat = await importedFixtureSpaceItemsToString(
                space1,
                session1,
                "JJ-Test-Flat.zip",
            );

            const space2 = await TestSpace.create(context);
            const session2 = await space2.createSession({role: "Admin"});
            const nested = await importedFixtureSpaceItemsToString(
                space2,
                session2,
                "JJ-Test-Nested.zip",
            );

            expect(flat).toBe(nested);
        });

        test("converts .md links with parentheses in filename to mentions", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create a document with parentheses in the title (like Notion exports)
            const targetDoc = new ExportedNotionDocument(
                "How Signing Works (August 2024 version)",
                "This document explains signing.",
            );

            // Create a parent document that manually references the target with a raw .md link
            // This simulates what Notion exports when documents reference each other
            const parentDoc = new ExportedNotionDocument(
                "Overview",
                // Use a direct markdown link to the target document's .md file The path will be
                // resolved by the test framework
                `See ${targetDoc.toReference()} for details.`,
                [targetDoc],
            );

            const zip = createTestNotionImportZip([parentDoc]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            // Find the documents
            const allDocs = await findDocumentsInSpace(space.id);
            const overviewDoc = allDocs.find(d => d.title === "Overview");
            const signingDoc = allDocs.find(
                d => d.title === "How Signing Works (August 2024 version)",
            );
            expect(overviewDoc).toBeDefined();
            expect(signingDoc).toBeDefined();

            // Get the full document content
            const overviewFullDoc = await getDocument(space.systemAction(), overviewDoc!.id);
            const overviewContent = overviewFullDoc.content.doc.toJSON();

            // The content should have a mention to the signing document, not a raw .md link
            // Find the paragraph with "See ... for details"
            const contentParagraph = overviewContent.content.find(
                (node: any) =>
                    node.type === "paragraph" &&
                    node.content?.some((c: any) => c.text?.includes("See ")),
            );

            expect(contentParagraph).toBeDefined();

            // Should contain a mention node (not a link to .md file)
            const hasMention = contentParagraph.content.some((c: any) => c.type === "mention");
            expect(hasMention).toBe(true);

            // Should NOT contain a link to .md file
            const hasMdLink = contentParagraph.content.some((c: any) =>
                c.marks?.some((m: any) => m.type === "link" && m.attrs?.url?.endsWith(".md")),
            );
            expect(hasMdLink).toBe(false);
        });

        test("document with only child links has empty body content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create child documents
            const child1 = new ExportedNotionDocument("First Child", "Child 1 content");
            const child2 = new ExportedNotionDocument("Second Child", "Child 2 content");

            // Create a parent document with ONLY child links (no other content) This simulates
            // Notion exports where a page is just a container for sub-pages
            const parentDoc = new ExportedNotionDocument(
                "Parent Page",
                `${child1.toReference()}

${child2.toReference()}`,
                [child1, child2],
            );

            const zip = createTestNotionImportZip([parentDoc]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            // Find the parent and child documents
            const allDocuments = await findDocumentsInSpace(space.id);
            const parentDocumentResult = allDocuments.find(d => d.title === "Parent Page");
            const child1DocumentResult = allDocuments.find(d => d.title === "First Child");
            const child2DocumentResult = allDocuments.find(d => d.title === "Second Child");
            expect(parentDocumentResult).toBeDefined();
            expect(child1DocumentResult).toBeDefined();
            expect(child2DocumentResult).toBeDefined();

            // Get the full document content
            const parentFullDocument = await getDocument(
                space.systemAction(),
                parentDocumentResult!.id,
            );
            const documentContent = parentFullDocument.content.doc.toJSON();

            // Document should have: title, Child documents heading, and two list items with
            // mentions The inline child links are removed since the content was ONLY child
            // links
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {type: "title", content: [{type: "text", text: "Parent Page"}]},
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [{type: "text", text: "Child documents"}],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "mention",
                                        attrs: {
                                            mention: {
                                                type: "SearchEntity",
                                                entityId: `Document:${child1DocumentResult!.id}`,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "mention",
                                        attrs: {
                                            mention: {
                                                type: "SearchEntity",
                                                entityId: `Document:${child2DocumentResult!.id}`,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ]),
            });

            // Verify children appear exactly once (only in Child documents section)
            const listItems = documentContent.content.filter(
                (node: {type: string}) => node.type === "unorderedListItem",
            );
            expect(listItems).toHaveLength(2);
        });
    });

    describe("with real test fixtures", () => {
        test("JJ-Test-Flat.zip - Database Page has inline table", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("JJ-Test-Flat.zip");

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Export",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});
            expect(importItem.importedCount).toBeGreaterThan(10);

            // Find documents by title
            const databasePageDoc = await findDocumentByTitle(space.id, "Database Page");
            const pageParentDoc = await findDocumentByTitle(space.id, "Page Parent");
            const inline1Doc = await findDocumentByTitle(space.id, "Inline 1");
            const inline2Doc = await findDocumentByTitle(space.id, "Inline 2");
            const inline3Doc = await findDocumentByTitle(space.id, "Inline 3");

            expect(databasePageDoc).toBeDefined();
            expect(pageParentDoc).toBeDefined();
            expect(inline1Doc).toBeDefined();
            expect(inline2Doc).toBeDefined();
            expect(inline3Doc).toBeDefined();

            // Get the full document
            const fullDoc = await getDocument(space.systemAction(), databasePageDoc!.id);
            const dbPageContent = fullDoc.content.doc.toJSON();

            // Verify basic document structure
            expect(dbPageContent.type).toBe("doc");
            expect(dbPageContent.attrs).toMatchObject({
                accessPolicy: {
                    defaultGrant: null,
                    urlGrant: null,
                },
                hasPresentShortcut: false,
                cover: null,
            });

            // Verify title
            expect(dbPageContent.content[0]).toEqual({
                type: "title",
                content: [{type: "text", text: "Database Page"}],
            });

            // Verify parent document mention to Page Parent (now parsed as mention node)
            const parentParagraph = dbPageContent.content.find(
                (node: any) =>
                    node.type === "paragraph" &&
                    node.content?.some((c: any) => c.text?.startsWith("Parent document:")),
            );
            expect(parentParagraph).toBeDefined();
            // Full assertion with parsed mention node
            expect(parentParagraph).toEqual({
                type: "paragraph",
                content: [
                    {type: "text", text: "Parent document: "},
                    {
                        type: "mention",
                        attrs: {
                            mention: {
                                type: "SearchEntity",
                                entityId: `Document:${pageParentDoc!.id}`,
                            },
                        },
                    },
                ],
            });

            // Find the table
            const tableNode = dbPageContent.content.find((node: any) => node.type === "table");
            expect(tableNode).toBeDefined();

            // Verify the full table structure
            expect(tableNode).toEqual({
                type: "table",
                attrs: {
                    columnWidths: [1, 1, 1],
                    tableWidth: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                },
                content: [
                    // Header row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Name"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Number"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [{type: "text", text: "Checkbox"}],
                                    },
                                ],
                            },
                        ],
                    },
                    // Inline 1 row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [documentMentionNode(inline1Doc!.id)],
                                    },
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Yes"}]},
                                ],
                            },
                        ],
                    },
                    // Inline 2 row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [documentMentionNode(inline2Doc!.id)],
                                    },
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "No"}]},
                                ],
                            },
                        ],
                    },
                    // Inline 3 row
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [documentMentionNode(inline3Doc!.id)],
                                    },
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "3"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "Yes"}]},
                                ],
                            },
                        ],
                    },
                ],
            });

            // Verify NO child documents section exists
            const hasChildDocsHeading = dbPageContent.content.some(
                (node: any) =>
                    node.type === "heading" && node.content?.[0]?.text === "Child documents",
            );
            expect(hasChildDocsHeading).toBe(false);

            // Verify the document can be serialized
            expect(() => {
                DocumentContentSchema.serialize(fullDoc.content.doc);
            }).not.toThrow();
        });

        test("JJ-Test-Nested.zip - nested page has parent link", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("JJ-Test-Nested.zip");

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Export",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});
            expect(importItem.importedCount).toBeGreaterThan(10);

            // Find "I'm a nested page" and "Page Parent" by title
            const nestedPageDoc = await findDocumentByTitle(space.id, "I’m a nested page");
            const pageParentDoc = await findDocumentByTitle(space.id, "Page Parent");

            expect(nestedPageDoc).toBeDefined();
            expect(pageParentDoc).toBeDefined();

            // Verify the nested page document structure
            const fullNestedDoc = await getDocument(space.systemAction(), nestedPageDoc!.id);
            const nestedContent = fullNestedDoc.content.doc.toJSON();

            expect(nestedContent.type).toBe("doc");
            expect(nestedContent.content[0]).toEqual({
                type: "title",
                content: [{type: "text", text: "I’m a nested page"}],
            });

            // Verify it has a parent document mention to Page Parent
            const nestedParentParagraph = nestedContent.content.find(
                (node: any) =>
                    node.type === "paragraph" &&
                    node.content?.some((c: any) => c.text?.startsWith("Parent document:")),
            );
            expect(nestedParentParagraph).toBeDefined();
            // Full assertion with mention node
            expect(nestedParentParagraph).toEqual({
                type: "paragraph",
                content: [
                    {type: "text", text: "Parent document: "},
                    documentMentionNode(pageParentDoc!.id),
                ],
            });

            // The nested page also has child documents, so verify Child documents section
            const nestedChildDocsHeading = nestedContent.content.find(
                (node: any) =>
                    node.type === "heading" && node.content?.[0]?.text === "Child documents",
            );
            expect(nestedChildDocsHeading).toBeDefined();

            // Find the double nested page document
            const doubleNestedDoc = await findDocumentByTitle(space.id, "I’m a double nested page");
            expect(doubleNestedDoc).toBeDefined();

            // Verify there's a list item mentioning the double nested page Mentions are now
            // parsed as mention nodes
            const nestedListItems = nestedContent.content.filter(
                (node: any) => node.type === "unorderedListItem",
            );
            const hasDoubleNestedPageMention = nestedListItems.some((item: any) => {
                const paragraph = item.content?.[0];
                const mentionNode = paragraph?.content?.[0];
                return mentionNode?.attrs?.mention?.entityId === `Document:${doubleNestedDoc!.id}`;
            });
            expect(hasDoubleNestedPageMention).toBe(true);

            // Verify "Page Parent" has child document links
            const fullParentDoc = await getDocument(space.systemAction(), pageParentDoc!.id);
            const parentContent = fullParentDoc.content.doc.toJSON();

            expect(parentContent.type).toBe("doc");
            expect(parentContent.content[0]).toEqual({
                type: "title",
                content: [{type: "text", text: "Page Parent"}],
            });

            // Verify it has a parent document link
            const parentParentParagraph = parentContent.content.find(
                (node: any) =>
                    node.type === "paragraph" &&
                    node.content?.some((c: any) => c.text?.startsWith("Parent document:")),
            );
            expect(parentParentParagraph).toBeDefined();

            // Verify it has child document section with link to nested page
            const parentChildDocsHeading = parentContent.content.find(
                (node: any) =>
                    node.type === "heading" && node.content?.[0]?.text === "Child documents",
            );
            expect(parentChildDocsHeading).toBeDefined();

            // Verify there's a list item mentioning the nested page Mentions are now parsed as
            // mention nodes
            const parentListItems = parentContent.content.filter(
                (node: any) => node.type === "unorderedListItem",
            );
            const hasNestedPageMention = parentListItems.some((item: any) => {
                const paragraph = item.content?.[0];
                const mentionNode = paragraph?.content?.[0];
                return mentionNode?.attrs?.mention?.entityId === `Document:${nestedPageDoc!.id}`;
            });
            expect(hasNestedPageMention).toBe(true);
        });

        test("JJ-Test-Flat.zip - creates all expected documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("JJ-Test-Flat.zip");

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Export",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});

            // Get all documents and their titles
            const allDocs = await findDocumentsInSpace(space.id);
            const docTitles = allDocs.map(d => d.title).sort();

            // Verify all expected documents are created Note: Home is excluded because it only
            // contains CSV links
            expect(docTitles).toEqual([
                "Another double nested page",
                "Check the box to mark items as done",
                "Click me to learn how to hide checked items",
                "Click me to learn how to see your content your way",
                "Click me to see even more detail",
                "Click the blue New button to add a task",
                "Click the due date to change it",
                "Database Page",
                "Empty",
                "Example sub-page",
                "Export",
                "Full Page 1",
                "Full Page 2",
                "Full Page 3",
                "Getting Started",
                "Improve website copy",
                "Inline 1",
                "Inline 2",
                "Inline 3",
                "I\u2019m a double nested page",
                "I\u2019m a nested page",
                "Josh Johnson",
                "Journal",
                "Markdown Tests",
                "Page Parent",
                "People",
                "Personal Website",
                "Publish release notes",
                "See finished items in the \u201CDone\u201D view",
                "To Do List",
                "Untitled",
                "Untitled",
                "Update help center & FAQ",
            ]);
        });

        test("JJ-Test-Nested.zip - creates all expected documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("JJ-Test-Nested.zip");

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Export",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await processStartNotionImportJob(
                createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({type: "Success"});

            // Get all documents and their titles
            const allDocs = await findDocumentsInSpace(space.id);
            const docTitles = allDocs.map(d => d.title).sort();

            // Verify all expected documents are created Note: Home is excluded because it only
            // contains CSV links
            expect(docTitles).toEqual([
                "Another double nested page",
                "Check the box to mark items as done",
                "Click me to learn how to hide checked items",
                "Click me to learn how to see your content your way",
                "Click me to see even more detail",
                "Click the blue New button to add a task",
                "Click the due date to change it",
                "Database Page",
                "Empty",
                "Example sub-page",
                "Export",
                "Full Page 1",
                "Full Page 2",
                "Full Page 3",
                "Getting Started",
                "Improve website copy",
                "Inline 1",
                "Inline 2",
                "Inline 3",
                "I\u2019m a double nested page",
                "I\u2019m a nested page",
                "Josh Johnson",
                "Journal",
                "Markdown Tests",
                "Page Parent",
                "People",
                "Personal Website",
                "Publish release notes",
                "See finished items in the \u201CDone\u201D view",
                "To Do List",
                "Untitled",
                "Untitled",
                "Update help center & FAQ",
            ]);
        });
    });

    describe("error handling", () => {
        test("fails gracefully when import file is not found", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: "Test Workspace",
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                teamspaceImportOptions: null,
                status: {type: "ProcessQueued"},
                importedCount: 0,
                importZipSize: 1024,
            });

            // Don't set up the file - it should fail
            await expect(
                processStartNotionImportJob(
                    createSystemActionWithFile(space, importKey),
                    notionImportId,
                ),
            ).rejects.toThrow("Notion import file not found");

            const importItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(importItem.status).toEqual({
                type: "Failed",
                error: "Import file not found in S3",
            });
        });
    });
});
