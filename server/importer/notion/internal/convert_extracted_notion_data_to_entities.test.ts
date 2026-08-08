import {Unzipped, strToU8} from "fflate";
import {readFileSync} from "fs";
import {join} from "path";

import {getDocument} from "~/server/documents/data/documents_actions.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {convertExtractedNotionDataToEntities} from "~/server/importer/notion/internal/convert_extracted_notion_data_to_entities.js";
import {normalizeNotionExportDirectory} from "~/server/importer/notion/internal/normalize_notion_export_directory.js";
import {NotionImporterProgressState} from "~/server/importer/notion/internal/notion_importer_progress_state.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {
    NotionImportMappedReferencesResult,
    NotionImportTeamspaceOption,
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
import {getSearchEntityTableForTest} from "~/server/search/data/table/get_search_entity_table_for_test.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DocumentContentSchema} from "~/shared/documents/document_content_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, FileId, NotionImportId} from "~/shared/id/types/id_types.open_source.js";
import {NotionImportItem} from "~/shared/importer/notion/notion_import_item.js";

/**
 * Creates a state manager from a mapped references result by extracting the
 * teamspace IDs. Requires context and notionImportId for DynamoDB persistence.
 */
function stateManagerFromResult({
    notionImportId,
    context,
    mappedResult,
}: {
    notionImportId: NotionImportId;
    context: ReturnType<TestSpace["systemAction"]>;
    mappedResult: NotionImportMappedReferencesResult;
}): NotionImporterProgressState {
    return new NotionImporterProgressState({
        notionImportId,
        context,
        initialResult: {
            teamspaces: new Map(
                mappedResult.teamspaces.map(ts => [
                    ts.id,
                    {documents: {imported: 0, expectedCount: 0}, files: new Map()},
                ]),
            ),
        },
    });
}

/**
 * Helper to properly unzip and map references from a test zip file. This uses the
 * disk-based flow (via test importer's in-memory storage) so that CSV files can be
 * read during conversion.
 */
async function unzipAndMapReferencesForTest(
    zipData: Uint8Array,
    importItem: NotionImportItem,
): Promise<NotionImportMappedReferencesResult> {
    const importKey = `test-${generateChronologicalId()}`;
    const importer = context.importer as unknown as TestImporterContextModule;
    await importer.setUploadedFile(importKey, zipData);

    const {diskPathToUnzippedFiles} = await importer.downloadAndUnzipImportToDisk({importKey});
    await normalizeNotionExportDirectory(diskPathToUnzippedFiles);

    const result = await parseNotionImportAndMapReferences(
        {tracer: context.tracer, importerService: importer},
        diskPathToUnzippedFiles,
        importItem,
    );

    expect(result).not.toBeNull();
    return result!;
}

const context = createTestContext({
    // Inject search so mentions can be resolved when getting documents
    searchInjection: {
        getSearchMentionEntityIfPossible: async () => null,
    },
});

/**
 * Create a minimal NotionImportItem for testing and insert it into the database.
 * Returns both the item and its ID.
 */
async function createTestNotionImportItemInDatabase(
    context: ReturnType<typeof createTestContext>,
    spaceId: string,
    accountId: string,
    overrides: Partial<NotionImportItem> = {},
): Promise<{notionImportId: NotionImportId; importItem: NotionImportItem}> {
    const notionImportId = generateId<NotionImportId>();
    const importItem: NotionImportItem = {
        spaceId: spaceId as any,
        startedByAccountId: accountId as any,
        workspaceName: "Test Workspace",
        importKey: "test-import-key",
        importZipSize: 1024,
        createdTime: new Date(),
        updatedTime: new Date(),
        startedProcessingTime: new Date(),
        teamspaceImportOptions: null,
        multipartUploadId: null,
        startedValidatingTime: null,
        status: {type: "Processing", result: {teamspaces: new Map()}},
        importedCount: 0,
        ...overrides,
    };

    await NotionImporterTable.createItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
        ...importItem,
    });

    return {notionImportId, importItem};
}

/**
 * Create a mapped references result for testing. Sets up the unzipped files in the
 * test importer so they can be read during conversion.
 */
async function createTestMappedReferencesResult(config: {
    teamspaces: Array<{
        id: string;
        name: string;
        importOption: NotionImportTeamspaceOption;
        documents: Array<{
            filePath: string;
            id: DocumentId;
            markdown: string;
            parentId?: DocumentId | null;
            childIds?: Array<DocumentId>;
            hasChildrenHeader?: boolean;
            references?: Map<string, DocumentId>;
            files?: Set<FileId>;
        }>;
    }>;
}): Promise<NotionImportMappedReferencesResult> {
    const unzippedFiles: Unzipped = {};
    const teamspaces: NotionImportMappedReferencesResult["teamspaces"] = [];
    const pathToDocumentId = new Map<string, DocumentId>();
    const documentIdToPath = new Map<DocumentId, string>();

    for (const ts of config.teamspaces) {
        const documents: NotionImportMappedReferencesResult["teamspaces"][0]["documents"] = {};

        for (const doc of ts.documents) {
            // Add file to unzippedFiles (paths are already stripped of root prefix)
            unzippedFiles[doc.filePath] = strToU8(doc.markdown);

            documents[doc.filePath] = {
                id: doc.id,
                references: doc.references ?? new Map(),
                files: doc.files ?? new Set(),
                parent: doc.parentId ? {documentId: doc.parentId, relativeFilePath: ""} : null,
                children: new Set(doc.childIds ?? []),
                hasChildrenHeader: doc.hasChildrenHeader ?? false,
            };

            pathToDocumentId.set(doc.filePath, doc.id);
            documentIdToPath.set(doc.id, doc.filePath);
        }

        teamspaces.push({
            id: ts.id,
            name: ts.name,
            importOption: ts.importOption,
            documents,
        });
    }

    // Generate a unique disk path key and set up the files in the test importer
    const diskPathKey = `test-import-${generateChronologicalId()}`;
    const importer = context.importer as unknown as TestImporterContextModule;
    await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
    const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

    return {
        // Use a unique workspace ID per call to avoid deterministic ID collisions between
        // tests. Each test gets its own "workspace" so teamspace root documents have
        // unique IDs.
        notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
        teamspaces,
        filesToUpload: {},
        diskPathToUnzippedFiles,
        inlineDatabaseChildren: new Map(),
        rootLevelCsvDatabases: new Map(),
        csvDatabasesRequiringDocuments: new Map(),
        pathToDocumentId,
        documentIdToPath,
        filePathToTeamspaceId: new Map(),
    };
}

const SearchEntityTable = getSearchEntityTableForTest();

describe("convertExtractedNotionDataToEntities", () => {
    describe("basic document creation", () => {
        test("does not assign affinity points to imported documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "My Page abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# My Page\n\nThis is the content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Imported documents should not get affinity points assigned. Only teamspace root
            // documents should get affinity points.
            expect(
                await SearchEntityTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId: space.id,
                    accountId: session.account.id,
                    entityId: `Document:${documentId}`,
                }),
            ).toBeNull();
        });

        test("creates a single document from notion import", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "My Page abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# My Page\n\nThis is the content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Verify the document was created
            const document = await getDocument(space.systemAction(), documentId);
            expect(document).toBeDefined();
            expect(document.content.doc.firstChild?.textContent).toBe("My Page");
        });

        test("creates multiple documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const doc1Id = generateId<DocumentId>();
            const doc2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Page One abc12345678901234567890abcdef123.md",
                                id: doc1Id,
                                markdown: "# Page One\n\nFirst page content.",
                            },
                            {
                                filePath: "Page Two def12345678901234567890abcdef123.md",
                                id: doc2Id,
                                markdown: "# Page Two\n\nSecond page content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const doc1 = await getDocument(space.systemAction(), doc1Id);
            const doc2 = await getDocument(space.systemAction(), doc2Id);

            expect(doc1).toBeDefined();
            expect(doc2).toBeDefined();
        });

        test("increments document counter for each document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const doc1Id = generateId<DocumentId>();
            const doc2Id = generateId<DocumentId>();
            const doc3Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc1 abc12345678901234567890abcdef123.md",
                                id: doc1Id,
                                markdown: "# Doc1\n\nContent 1.",
                            },
                            {
                                filePath: "Doc2 def12345678901234567890abcdef123.md",
                                id: doc2Id,
                                markdown: "# Doc2\n\nContent 2.",
                            },
                            {
                                filePath: "Doc3 abc234567890123456789012345678ab.md",
                                id: doc3Id,
                                markdown: "# Doc3\n\nContent 3.",
                            },
                        ],
                    },
                ],
            });

            const progressState = stateManagerFromResult({
                notionImportId,
                context: space.systemAction(),
                mappedResult,
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                progressState,
            );

            // Verify the document counter was incremented (3 docs + 1 teamspace root)
            expect(progressState.teamspaceCounters.get("ts1")?.documents).toBe(4);
        });
    });

    describe("access policy based on teamspace import option", () => {
        test("public teamspace creates document with defaultGrant Edit", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Public Teamspace",
                        importOption: {type: "Public"},
                        documents: [
                            {
                                filePath: "Public Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Public Doc\n\nPublic content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document.content.doc.attrs.accessPolicy.defaultGrant).toEqual({level: "Edit"});
        });

        test("private teamspace creates document without defaultGrant", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Private Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Private Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Private Doc\n\nPrivate content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document.content.doc.attrs.accessPolicy.defaultGrant).toBeNull();
        });

        test("importer account has Manage access", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Test Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Test Doc\n\nContent.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const accountGrant = document.content.doc.attrs.accessPolicy.accountGrantById.get(
                session.account.id,
            );
            expect(accountGrant).toEqual({level: "Manage", generation: 0});
        });

        test("documents in different teamspaces have different access policies", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const publicDocId = generateId<DocumentId>();
            const privateDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts-public",
                        name: "Public Teamspace",
                        importOption: {type: "Public"},
                        documents: [
                            {
                                filePath: "Public abc12345678901234567890abcdef123.md",
                                id: publicDocId,
                                markdown: "# Public\n\nPublic content.",
                            },
                        ],
                    },
                    {
                        id: "ts-private",
                        name: "Private Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Private def12345678901234567890abcdef123.md",
                                id: privateDocId,
                                markdown: "# Private\n\nPrivate content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const publicDoc = await getDocument(space.systemAction(), publicDocId);
            const privateDoc = await getDocument(space.systemAction(), privateDocId);

            expect(publicDoc.content.doc.attrs.accessPolicy.defaultGrant).toEqual({level: "Edit"});
            expect(privateDoc.content.doc.attrs.accessPolicy.defaultGrant).toBeNull();
        });
    });

    describe("document content parsing", () => {
        test("parses markdown headings", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown:
                                    "# Doc\n\n## Section 1\n\nContent under section 1.\n\n## Section 2\n\nContent under section 2.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            // Document should have title and body content
            expect(document.content.doc.childCount).toBeGreaterThan(1);
        });

        test("parses markdown lists", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Doc\n\n- Item 1\n- Item 2\n- Item 3",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document.content.doc.childCount).toBeGreaterThan(1);
        });

        test("parses markdown code blocks", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Doc\n\n```javascript\nconst x = 1;\n```",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document.content.doc.childCount).toBeGreaterThan(1);
        });
    });

    describe("parent-child relationships", () => {
        test("adds parent document link to child document content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentId = generateId<DocumentId>();
            const childId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentId,
                                markdown: "# Parent\n\nParent content.",
                                childIds: [childId],
                            },
                            {
                                filePath: "Child def12345678901234567890abcdef123.md",
                                id: childId,
                                markdown: "# Child\n\nChild content.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const childDocument = await getDocument(space.systemAction(), childId);
            const documentContent = childDocument.content.doc.toJSON();

            // The document content should contain a mention link to the parent
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${parentId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("adds child documents section to parent document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentId = generateId<DocumentId>();
            const child1Id = generateId<DocumentId>();
            const child2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentId,
                                markdown: "# Parent\n\nParent content.",
                                childIds: [child1Id, child2Id],
                            },
                            {
                                filePath: "Child1 def12345678901234567890abcdef123.md",
                                id: child1Id,
                                markdown: "# Child1\n\nChild 1 content.",
                                parentId,
                            },
                            {
                                filePath: "Child2 abc234567890123456789012345678ab.md",
                                id: child2Id,
                                markdown: "# Child2\n\nChild 2 content.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentId);
            const documentContent = parentDocument.content.doc.toJSON();

            // The document content should contain Child documents section with mentions
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
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
                                                entityId: `Document:${child1Id}`,
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
                                                entityId: `Document:${child2Id}`,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ]),
            });
        });
    });

    describe("document reference linking", () => {
        test("replaces notion links with alpine document links", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const doc1Id = generateId<DocumentId>();
            const doc2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc1 abc12345678901234567890abcdef123.md",
                                id: doc1Id,
                                markdown:
                                    "# Doc1\n\nLink to [Doc2](Doc2%20def12345678901234567890abcdef123.md)",
                                references: new Map([
                                    ["Doc2 def12345678901234567890abcdef123.md", doc2Id],
                                ]),
                            },
                            {
                                filePath: "Doc2 def12345678901234567890abcdef123.md",
                                id: doc2Id,
                                markdown: "# Doc2\n\nDoc2 content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document1 = await getDocument(space.systemAction(), doc1Id);
            const documentContent = document1.content.doc.toJSON();

            // Should contain mention with the document ID
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${doc2Id}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("resolves relative parent directory paths (../) in nested exports", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const nestedDocId = generateId<DocumentId>();
            const siblingDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Simulate nested export structure: Parent/ ParentDoc abc123.md Subdir/ NestedDoc
            // def456.md (links to ../SiblingDoc.md) SiblingDoc ghi789.md
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                markdown: "# Parent\n\nParent content.",
                            },
                            {
                                filePath: "Parent/NestedDoc def12345678901234567890abcdef456.md",
                                id: nestedDocId,
                                // Link uses ../ to go up to parent directory
                                markdown:
                                    "# NestedDoc\n\nLink to [Sibling](../Sibling%20ghi12345678901234567890abcdef789.md)",
                                references: new Map([
                                    ["Sibling ghi12345678901234567890abcdef789.md", siblingDocId],
                                ]),
                            },
                            {
                                filePath: "Sibling ghi12345678901234567890abcdef789.md",
                                id: siblingDocId,
                                markdown: "# Sibling\n\nSibling content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const nestedDocument = await getDocument(space.systemAction(), nestedDocId);
            const documentContent = nestedDocument.content.doc.toJSON();

            // The relative path ../Sibling.md should resolve to a mention
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${siblingDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("resolves subdirectory paths in nested exports", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Simulate nested export where parent links to child in subdirectory
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "ParentDoc abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                // Link includes subdirectory path
                                markdown:
                                    "# ParentDoc\n\nLink to [Child](ParentDoc/ChildDoc%20def12345678901234567890abcdef456.md)",
                                references: new Map([
                                    [
                                        "ParentDoc/ChildDoc def12345678901234567890abcdef456.md",
                                        childDocId,
                                    ],
                                ]),
                            },
                            {
                                filePath: "ParentDoc/ChildDoc def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown: "# ChildDoc\n\nChild content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            // The subdirectory path should resolve to a mention
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("resolves .md links with parentheses in filename", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test that .md links with parentheses in the filename are properly converted. The
            // regex needs to handle URLs like "File%20(info)%20abc.md" where the URL-encoded
            // parentheses should not break the match.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                // Link to a document with parentheses in the name
                                markdown:
                                    "# Parent\n\nSee [How It Works](How%20It%20Works%20%28August%202024%20version%29%20def12345678901234567890abcdef456.md) for details.",
                            },
                            {
                                filePath:
                                    "How It Works (August 2024 version) def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown:
                                    "# How It Works (August 2024 version)\n\nExplanation here.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            // The .md link with parentheses should be converted to a mention
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "See "},
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                            {type: "text", text: " for details."},
                        ]),
                    },
                ]),
            });

            // Should NOT still have the .md extension in any link
            const documentString = JSON.stringify(documentContent);
            expect(documentString).not.toContain(".md");
        });

        test("resolves .md links with multiple parentheses in filename", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test multiple parentheses sets in a single filename.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                markdown:
                                    "# Parent\n\nSee [Guide](Guide%20%28v1%29%20%28draft%29%20def12345678901234567890abcdef456.md) for details.",
                            },
                            {
                                filePath: "Guide (v1) (draft) def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown: "# Guide (v1) (draft)\n\nContent here.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            // The .md link should be converted to a mention
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });

            // Should NOT still have the .md extension in any link
            const documentString = JSON.stringify(documentContent);
            expect(documentString).not.toContain(".md");
        });

        test("resolves .md links with parentheses at start of filename", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test parentheses at the start of the filename.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                markdown:
                                    "# Parent\n\nSee [Doc](%28IMPORTANT%29%20Read%20First%20def12345678901234567890abcdef456.md).",
                            },
                            {
                                filePath:
                                    "(IMPORTANT) Read First def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown: "# (IMPORTANT) Read First\n\nContent.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("resolves .md links with nested parentheses in filename", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test nested parentheses like "(see (note) here)".
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                markdown:
                                    "# Parent\n\nSee [Doc](Notes%20%28see%20%28inner%29%20details%29%20def12345678901234567890abcdef456.md).",
                            },
                            {
                                filePath:
                                    "Notes (see (inner) details) def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown: "# Notes (see (inner) details)\n\nContent.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("resolves .md links with only closing paren in filename", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const childDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test filename with only closing paren (unbalanced).
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                markdown:
                                    "# Parent\n\nSee [Doc](Smile%20%3A%29%20Doc%20def12345678901234567890abcdef456.md).",
                            },
                            {
                                filePath: "Smile :) Doc def12345678901234567890abcdef456.md",
                                id: childDocId,
                                markdown: "# Smile :) Doc\n\nContent.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${childDocId}`,
                                    },
                                },
                            },
                        ]),
                    },
                ]),
            });
        });

        test("handles document title with parentheses in content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Test that a document whose title (# heading) contains parentheses is parsed
            // correctly.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath:
                                    "Project Overview (Q4 2024) abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown:
                                    "# Project Overview (Q4 2024)\n\nThis is the project overview for Q4 2024.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);

            // Title should be extracted correctly with parentheses
            expect(document.content.doc.firstChild?.textContent).toBe("Project Overview (Q4 2024)");
        });

        test("document with only child links has empty body content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const child1Id = generateId<DocumentId>();
            const child2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // A document that has ONLY child links (no other content) should have empty body
            // content - the Child documents section provides the structure.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                childIds: [child1Id, child2Id],
                                // Content is ONLY child links (these will be converted to autolinks)
                                markdown: `# Parent

[Child1](Child1%20def12345678901234567890abcdef456.md)
[Child2](Child2%20ghi12345678901234567890abcdef789.md)`,
                            },
                            {
                                filePath: "Child1 def12345678901234567890abcdef456.md",
                                id: child1Id,
                                parentId: parentDocId,
                                markdown: "# Child1\n\nChild 1 content.",
                            },
                            {
                                filePath: "Child2 ghi12345678901234567890abcdef789.md",
                                id: child2Id,
                                parentId: parentDocId,
                                markdown: "# Child2\n\nChild 2 content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            // Document should have: title, Child documents heading, and two list items with
            // mentions The inline child links are removed since the content was ONLY child
            // links
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {type: "title", content: [{type: "text", text: "Parent"}]},
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
                                                entityId: `Document:${child1Id}`,
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
                                                entityId: `Document:${child2Id}`,
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
            const mentionNodes = documentContent.content.filter(
                (node: {type: string}) => node.type === "unorderedListItem",
            );
            expect(mentionNodes).toHaveLength(2);
        });

        test("document with real content keeps inline mentions", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentDocId = generateId<DocumentId>();
            const child1Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // A document with real content AND inline child links should keep the inline
            // links. Only documents with ONLY child links have the inline content removed.
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentDocId,
                                childIds: [child1Id],
                                // Content has real text AND a child link
                                markdown: `# Parent

Main content here.

---

Related:

[Child1](Child1%20def12345678901234567890abcdef456.md)`,
                            },
                            {
                                filePath: "Child1 def12345678901234567890abcdef456.md",
                                id: child1Id,
                                parentId: parentDocId,
                                markdown: "# Child1\n\nChild content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDocument = await getDocument(space.systemAction(), parentDocId);
            const documentContent = parentDocument.content.doc.toJSON();

            // Document should have: title, main content, Related text, inline mention, Child
            // documents heading, and list item with mention
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {type: "title", content: [{type: "text", text: "Parent"}]},
                    // Main content paragraph
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Main content here."}],
                    },
                    // Related: text
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Related:"}],
                    },
                    // Inline mention (not removed because document has real content)
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${child1Id}`,
                                    },
                                },
                            },
                        ],
                    },
                    // Child documents section
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
                                                entityId: `Document:${child1Id}`,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ]),
            });

            // Child should appear twice: once inline, once in Child documents section
            const allMentions = JSON.stringify(documentContent).match(
                new RegExp(`Document:${child1Id}`, "g"),
            );
            expect(allMentions).toHaveLength(2);
        });
    });

    describe("edge cases", () => {
        test("handles empty teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [],
            });

            // Should not throw
            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );
        });

        test("handles teamspace with no documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Empty Teamspace",
                        importOption: {type: "Private"},
                        documents: [],
                    },
                ],
            });

            // Should not throw
            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );
        });

        test("handles documents with special characters in title", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath:
                                    "Doc with & special < chars > abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# Doc with & special < chars >\n\nContent.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document).toBeDefined();
        });

        test("handles deeply nested content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Complex abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: `# Complex

> Quote with **bold** and *italic*
>
> - Nested list item 1
>   - Deeply nested
> - Nested list item 2

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document).toBeDefined();
            expect(document.content.doc.childCount).toBeGreaterThan(1);
        });

        test("handles tables with empty cells", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Table abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: `# Table with empty cells

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   |          | Cell 3   |
|          | Cell 2   |          |
`,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            expect(document).toBeDefined();

            // Verify the content can be serialized (this triggers schema validation)
            expect(() => {
                DocumentContentSchema.serialize(document.content.doc);
            }).not.toThrow();
        });

        test("document counter remains 0 when no documents are created", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [],
            });

            const progressState = stateManagerFromResult({
                notionImportId,
                context: space.systemAction(),
                mappedResult,
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                progressState,
            );

            expect(progressState.teamspaceCounters.size).toBe(0);
        });
    });

    describe("markdown content reformatting", () => {
        test("extracts title from first # heading and removes it from content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "My Document abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "# My Document Title\n\nThis is the body content.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Title should be extracted from # heading
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "My Document Title"}],
            });
            // Body content should follow (after parent link)
            const bodyParagraph = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "paragraph" &&
                    node.content?.[0]?.text === "This is the body content.",
            );
            expect(bodyParagraph).toBeDefined();
        });

        test("promotes heading levels by one (## becomes #, ### becomes ##)", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Doc abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: `# Document Title

## Section One

Content under section one.

### Subsection

Content under subsection.`,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Title should be extracted
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Document Title"}],
            });

            // Headings should be promoted (## -> h1, ### -> h2)
            const h1Section = documentContent.content.find(
                (node: {type: string; attrs?: {level: number}; content?: Array<{text?: string}>}) =>
                    node.type === "heading" &&
                    node.attrs?.level === 1 &&
                    node.content?.[0]?.text === "Section One",
            );
            expect(h1Section).toBeDefined();

            const h2Subsection = documentContent.content.find(
                (node: {type: string; attrs?: {level: number}; content?: Array<{text?: string}>}) =>
                    node.type === "heading" &&
                    node.attrs?.level === 2 &&
                    node.content?.[0]?.text === "Subsection",
            );
            expect(h2Subsection).toBeDefined();
        });

        test("removes child links section and divider after title", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentId = generateId<DocumentId>();
            const child1Id = generateId<DocumentId>();
            const child2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentId,
                                // Notion format: title, child links, divider, then content
                                markdown: `# Parent Page

[Child One](Child%20One%20def12345678901234567890abcdef123.md)

[Child Two](Child%20Two%20abc234567890123456789012345678ab.md)

---

This is the actual content.`,
                                childIds: [child1Id, child2Id],
                                hasChildrenHeader: true,
                            },
                            {
                                filePath: "Child One def12345678901234567890abcdef123.md",
                                id: child1Id,
                                markdown: "# Child One\n\nChild one content.",
                                parentId,
                            },
                            {
                                filePath: "Child Two abc234567890123456789012345678ab.md",
                                id: child2Id,
                                markdown: "# Child Two\n\nChild two content.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDoc = await getDocument(space.systemAction(), parentId);
            const documentContent = parentDoc.content.doc.toJSON();

            // Document should have: title, parent link, actual content paragraph, "Child
            // documents" heading, list items The child links section and divider should be
            // removed
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Parent Page"}],
            });

            // Content paragraph should exist
            const contentParagraph = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "paragraph" &&
                    node.content?.[0]?.text === "This is the actual content.",
            );
            expect(contentParagraph).toBeDefined();

            // Child documents heading should exist
            const childDocsHeading = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "heading" && node.content?.[0]?.text === "Child documents",
            );
            expect(childDocsHeading).toBeDefined();

            // Should have two list items for the children
            const listItems = documentContent.content.filter(
                (node: {type: string}) => node.type === "unorderedListItem",
            );
            expect(listItems.length).toBe(2);
        });

        test("adds parent document mention at the top of child documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentId = generateId<DocumentId>();
            const childId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent Doc abc12345678901234567890abcdef123.md",
                                id: parentId,
                                markdown: "# Parent Doc\n\nParent content.",
                                childIds: [childId],
                            },
                            {
                                filePath: "Child Doc def12345678901234567890abcdef123.md",
                                id: childId,
                                markdown: "# Child Doc\n\nChild content here.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const childDoc = await getDocument(space.systemAction(), childId);
            const documentContent = childDoc.content.doc.toJSON();

            // Child document should have: title, parent mention paragraph, content paragraph
            // Parent document link is parsed as a mention node
            expect(documentContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Child Doc"}]},
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${parentId}`,
                                    },
                                },
                            },
                        ],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Child content here."}]},
                ],
            });
        });

        test("adds Child documents section with mentions at the end of parent documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const parentId = generateId<DocumentId>();
            const child1Id = generateId<DocumentId>();
            const child2Id = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Parent abc12345678901234567890abcdef123.md",
                                id: parentId,
                                markdown: "# Parent\n\nSome parent content.",
                                childIds: [child1Id, child2Id],
                            },
                            {
                                filePath: "First Child def12345678901234567890abcdef123.md",
                                id: child1Id,
                                markdown: "# First Child\n\nFirst child content.",
                                parentId,
                            },
                            {
                                filePath: "Second Child abc234567890123456789012345678ab.md",
                                id: child2Id,
                                markdown: "# Second Child\n\nSecond child content.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDoc = await getDocument(space.systemAction(), parentId);
            const documentContent = parentDoc.content.doc.toJSON();

            // Title should be correct
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Parent"}],
            });

            // Content paragraph should exist
            const contentParagraph = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "paragraph" && node.content?.[0]?.text === "Some parent content.",
            );
            expect(contentParagraph).toBeDefined();

            // Child documents heading should exist
            const childDocsHeading = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "heading" && node.content?.[0]?.text === "Child documents",
            );
            expect(childDocsHeading).toBeDefined();

            // Should have two list items with mention links to children
            const listItems = documentContent.content.filter(
                (node: {type: string}) => node.type === "unorderedListItem",
            );
            expect(listItems).toHaveLength(2);

            // Verify child links are present as parsed mention nodes
            expect(listItems[0]).toMatchObject({
                type: "unorderedListItem",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${child1Id}`,
                                    },
                                },
                            },
                        ],
                    },
                ],
            });
            expect(listItems[1]).toMatchObject({
                type: "unorderedListItem",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${child2Id}`,
                                    },
                                },
                            },
                        ],
                    },
                ],
            });
        });

        test("falls back to filename for title when no # heading exists", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Fallback Title abc12345678901234567890abcdef123.md",
                                id: documentId,
                                markdown: "This document has no heading.\n\nJust paragraphs.",
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Title should fall back to filename
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Fallback Title"}],
            });

            // Content paragraphs should exist
            const noHeadingParagraph = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "paragraph" &&
                    node.content?.[0]?.text === "This document has no heading.",
            );
            expect(noHeadingParagraph).toBeDefined();

            const justParagraphs = documentContent.content.find(
                (node: {type: string; content?: Array<{text?: string}>}) =>
                    node.type === "paragraph" && node.content?.[0]?.text === "Just paragraphs.",
            );
            expect(justParagraphs).toBeDefined();
        });

        test("replaces inline CSV database links with table content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create mapped result with CSV file in unzippedFiles
            const unzippedFiles: Unzipped = {
                "Doc abc12345678901234567890abcdef123.md": strToU8(`# Document with Database

Here is an inline database:

[Tasks](Tasks%20def12345678901234567890abcdef123.csv)

And some content after.`),
                "Tasks def12345678901234567890abcdef123.csv": strToU8(
                    `Name,Status,Priority
Task 1,Done,High
Task 2,In Progress,Medium`,
                ),
            };

            const docPath = "Doc abc12345678901234567890abcdef123.md";
            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const csvPath = "Tasks def12345678901234567890abcdef123.csv";
            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [docPath]: {
                                id: documentId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                // Include the CSV path so the conversion function reads it
                inlineDatabaseChildren: new Map([[csvPath, new Map()]]),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[docPath, documentId]]),
                documentIdToPath: new Map([[documentId, docPath]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Title should be correct
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Document with Database"}],
            });

            // Verify the document contains the expected content structure
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Here is an inline database:"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "And some content after."}],
                    },
                ]),
            });

            // Verify the table structure with headers and data
            const table = documentContent.content.find(
                (node: {type: string}) => node.type === "table",
            );
            expect(table).toBeDefined();
            expect(table.attrs).toMatchObject({hasHeaderRow: true});
            expect(table.content).toHaveLength(3); // Header + 2 data rows

            // Helper to extract text from a table cell
            const getCellText = (cell: {content: Array<{content: Array<{text: string}>}>}) =>
                cell.content[0]?.content[0]?.text;

            // Verify header row
            const headerRow = table.content[0];
            expect(getCellText(headerRow.content[0])).toBe("Name");
            expect(getCellText(headerRow.content[1])).toBe("Status");
            expect(getCellText(headerRow.content[2])).toBe("Priority");

            // Verify data rows
            const dataRow1 = table.content[1];
            expect(getCellText(dataRow1.content[0])).toBe("Task 1");
            expect(getCellText(dataRow1.content[1])).toBe("Done");
            expect(getCellText(dataRow1.content[2])).toBe("High");

            const dataRow2 = table.content[2];
            expect(getCellText(dataRow2.content[0])).toBe("Task 2");
            expect(getCellText(dataRow2.content[1])).toBe("In Progress");
            expect(getCellText(dataRow2.content[2])).toBe("Medium");
        });

        test("replaces multiple inline CSV databases in a single document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create mapped result with two CSV files in unzippedFiles
            const unzippedFiles: Unzipped = {
                "Doc abc12345678901234567890abcdef123.md":
                    strToU8(`# Document with Multiple Databases

Here is the first database:

[Tasks](Tasks%20def12345678901234567890abcdef123.csv)

And here is the second database:

[People](People%20ghi12345678901234567890abcdef123.csv)

Content after both databases.`),
                "Tasks def12345678901234567890abcdef123.csv": strToU8(
                    `Task,Status
Task 1,Done
Task 2,Pending`,
                ),
                "People ghi12345678901234567890abcdef123.csv": strToU8(
                    `Name,Role
Alice,Engineer
Bob,Designer`,
                ),
            };

            const docPath = "Doc abc12345678901234567890abcdef123.md";
            const tasksCsvPath = "Tasks def12345678901234567890abcdef123.csv";
            const peopleCsvPath = "People ghi12345678901234567890abcdef123.csv";
            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [docPath]: {
                                id: documentId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                // Include both CSV paths so the conversion function reads them
                inlineDatabaseChildren: new Map([
                    [tasksCsvPath, new Map()],
                    [peopleCsvPath, new Map()],
                ]),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[docPath, documentId]]),
                documentIdToPath: new Map([[documentId, docPath]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Should have title
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Document with Multiple Databases"}],
            });

            // Find all tables in the document
            const tables = documentContent.content.filter(
                (node: {type: string}) => node.type === "table",
            );
            expect(tables).toHaveLength(2);

            // Helper to extract text from a table cell
            const getCellText = (cell: {content: Array<{content: Array<{text: string}>}>}) =>
                cell.content[0]?.content[0]?.text;

            // First table should be Tasks
            const tasksTable = tables[0];
            expect(tasksTable.attrs).toMatchObject({
                hasHeaderRow: true,
                tableWidth: 1,
                columnWidths: [1, 1],
            });
            expect(getCellText(tasksTable.content[0].content[0])).toBe("Task");
            expect(getCellText(tasksTable.content[0].content[1])).toBe("Status");
            expect(getCellText(tasksTable.content[1].content[0])).toBe("Task 1");
            expect(getCellText(tasksTable.content[1].content[1])).toBe("Done");

            // Second table should be People
            const peopleTable = tables[1];
            expect(peopleTable.attrs).toMatchObject({
                hasHeaderRow: true,
                tableWidth: 1,
                columnWidths: [1, 1],
            });
            expect(getCellText(peopleTable.content[0].content[0])).toBe("Name");
            expect(getCellText(peopleTable.content[0].content[1])).toBe("Role");
            expect(getCellText(peopleTable.content[1].content[0])).toBe("Alice");
            expect(getCellText(peopleTable.content[1].content[1])).toBe("Engineer");

            // Verify the text content around the tables exists
            const paragraphs = documentContent.content.filter(
                (node: {type: string}) => node.type === "paragraph",
            );
            const paragraphTexts = paragraphs.map(
                (p: {content?: Array<{text?: string}>}) => p.content?.[0]?.text,
            );
            expect(paragraphTexts).toContain("Here is the first database:");
            expect(paragraphTexts).toContain("And here is the second database:");
            expect(paragraphTexts).toContain("Content after both databases.");
        });

        test("inline CSV table has correct API content structure", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a CSV with 4 columns to verify column width calculation
            const unzippedFiles: Unzipped = {
                "Doc abc12345678901234567890abcdef123.md": strToU8(`# Document

[Data](Data%20def12345678901234567890abcdef123.csv)`),
                "Data def12345678901234567890abcdef123.csv": strToU8(
                    `A,B,C,D
1,2,3,4`,
                ),
            };

            const docPath = "Doc abc12345678901234567890abcdef123.md";
            const dataCsvPath = "Data def12345678901234567890abcdef123.csv";
            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [docPath]: {
                                id: documentId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                // Include the CSV path so the conversion function reads it
                inlineDatabaseChildren: new Map([[dataCsvPath, new Map()]]),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[docPath, documentId]]),
                documentIdToPath: new Map([[documentId, docPath]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // Find the table
            const table = documentContent.content.find(
                (node: {type: string}) => node.type === "table",
            );
            expect(table).toBeDefined();

            // Verify full table structure from API content
            expect(table.attrs).toMatchObject({
                hasHeaderRow: true,
                hasHeaderColumn: false,
                tableWidth: 1,
                columnWidths: [1, 1, 1, 1], // 4 equal columns
            });

            // Verify row count
            expect(table.content).toHaveLength(2); // Header + 1 data row

            // Verify cell structure - each cell should have a paragraph with text
            const headerRow = table.content[0];
            expect(headerRow.type).toBe("tableRow");
            expect(headerRow.content).toHaveLength(4);

            for (const cell of headerRow.content) {
                expect(cell.type).toBe("tableCell");
                expect(cell.content[0].type).toBe("paragraph");
            }
        });

        test("skips CSV links when the file is missing from the export", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Notion sometimes omits inline database CSV files from the export while still
            // including the markdown link. The document should be created successfully with
            // the CSV link kept as a regular paragraph instead of being converted to a table.
            const unzippedFiles: Unzipped = {
                "Doc abc12345678901234567890abcdef123.md": strToU8(`# Document with Missing DB

Here is a linked database:

[Tasks](Tasks%20def12345678901234567890abcdef123.csv)

And some content after.`),
            };

            const docPath = "Doc abc12345678901234567890abcdef123.md";
            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [docPath]: {
                                id: documentId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                inlineDatabaseChildren: new Map(),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[docPath, documentId]]),
                documentIdToPath: new Map([[documentId, docPath]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Document with Missing DB"}],
            });

            // Content after the missing CSV link should still be present
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "And some content after."}],
                    },
                ]),
            });

            // No table should have been created (CSV was missing)
            const hasTable = documentContent.content.some(
                (node: {type: string}) => node.type === "table",
            );
            expect(hasTable).toBe(false);
        });

        test("skips missing CSV but still converts existing CSVs in same document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const documentId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Document references two CSVs: one that exists and one that doesn't. The existing
            // one should become a table, the missing one should stay as a paragraph.
            const unzippedFiles: Unzipped = {
                "Doc abc12345678901234567890abcdef123.md": strToU8(`# Mixed Database Document

[Exists](Exists%20aaa12345678901234567890abcdef123.csv)

[Missing](Missing%20bbb12345678901234567890abcdef123.csv)

End of document.`),
                "Exists aaa12345678901234567890abcdef123.csv": strToU8(`Name,Status\nTask 1,Done`),
            };

            const docPath = "Doc abc12345678901234567890abcdef123.md";
            const existsCsvPath = "Exists aaa12345678901234567890abcdef123.csv";
            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [docPath]: {
                                id: documentId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                inlineDatabaseChildren: new Map([[existsCsvPath, new Map()]]),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[docPath, documentId]]),
                documentIdToPath: new Map([[documentId, docPath]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), documentId);
            const documentContent = document.content.doc.toJSON();

            // The existing CSV should have been converted to a table
            const table = documentContent.content.find(
                (node: {type: string}) => node.type === "table",
            );
            expect(table).toBeDefined();
            expect(table.content).toHaveLength(2); // Header + 1 data row

            // "End of document" should still be present
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "End of document."}],
                    },
                ]),
            });
        });

        test("creates full-page database documents from CSV files", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const databaseDocId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Database .md wrapper file and its CSV data The .md file links to the CSV, and
            // the CSV link gets converted to a table
            const csvFileName = "Project Tasks abc12345678901234567890abcdef123.csv";
            const mdFileName = "Project Tasks abc12345678901234567890abcdef123.md";
            const unzippedFiles: Unzipped = {
                [csvFileName]: strToU8(
                    `Task,Assignee,Due Date
Build feature,Alice,2024-01-15
Write tests,Bob,2024-01-20`,
                ),
                [mdFileName]: strToU8(
                    `# Project Tasks\n\n[Project Tasks](${encodeURIComponent(csvFileName)})\n`,
                ),
            };

            const diskPathKey = `test-import-${generateChronologicalId()}`;
            const importer = context.importer as unknown as TestImporterContextModule;
            await importer.setUnzippedFiles(diskPathKey, unzippedFiles);
            const diskPathToUnzippedFiles = importer.getUnzippedFilesPath(diskPathKey);

            const mappedResult: NotionImportMappedReferencesResult = {
                notionWorkspaceId: `test-workspace-${crypto.randomUUID()}`,
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: {
                            [mdFileName]: {
                                id: databaseDocId,
                                references: new Map(),
                                files: new Set(),
                                parent: null,
                                children: new Set(),
                                hasChildrenHeader: false,
                            },
                        },
                    },
                ],
                filesToUpload: {},
                diskPathToUnzippedFiles,
                // For full-page databases, the CSV is referenced by the .md file and needs to be
                // in inlineDatabaseChildren so the conversion reads it
                inlineDatabaseChildren: new Map([[csvFileName, new Map()]]),
                rootLevelCsvDatabases: new Map(),
                csvDatabasesRequiringDocuments: new Map(),
                pathToDocumentId: new Map([[mdFileName, databaseDocId]]),
                documentIdToPath: new Map([[databaseDocId, mdFileName]]),
                filePathToTeamspaceId: new Map(),
            };

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const document = await getDocument(space.systemAction(), databaseDocId);
            const documentContent = document.content.doc.toJSON();

            // Full-page database should have title from filename and table content
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Project Tasks"}],
            });

            // Should have a table
            const table = documentContent.content.find(
                (node: {type: string}) => node.type === "table",
            );
            expect(table).toBeDefined();
            expect(table.content).toHaveLength(3); // Header + 2 data rows

            // Helper to extract text from a table cell
            const getCellText = (cell: {content: Array<{content: Array<{text: string}>}>}) =>
                cell.content[0]?.content[0]?.text;

            // Verify header row
            const headerRow = table.content[0];
            expect(getCellText(headerRow.content[0])).toBe("Task");
            expect(getCellText(headerRow.content[1])).toBe("Assignee");
            expect(getCellText(headerRow.content[2])).toBe("Due Date");

            // Verify data rows
            const dataRow1 = table.content[1];
            expect(getCellText(dataRow1.content[0])).toBe("Build feature");
            expect(getCellText(dataRow1.content[1])).toBe("Alice");

            const dataRow2 = table.content[2];
            expect(getCellText(dataRow2.content[0])).toBe("Write tests");
            expect(getCellText(dataRow2.content[1])).toBe("Bob");
        });

        test("full document structure: parent link, promoted headings, child section", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const grandparentId = generateId<DocumentId>();
            const parentId = generateId<DocumentId>();
            const childId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "Grandparent abc12345678901234567890abcdef123.md",
                                id: grandparentId,
                                markdown: "# Grandparent\n\nGrandparent content.",
                                childIds: [parentId],
                            },
                            {
                                filePath: "Parent def12345678901234567890abcdef123.md",
                                id: parentId,
                                markdown: `# Parent Document

[Child Page](Child%20abc234567890123456789012345678ab.md)

---

## Introduction

This is the introduction.

### Details

Here are some details.`,
                                parentId: grandparentId,
                                childIds: [childId],
                                hasChildrenHeader: true,
                            },
                            {
                                filePath: "Child abc234567890123456789012345678ab.md",
                                id: childId,
                                markdown: "# Child Page\n\nChild content.",
                                parentId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const parentDoc = await getDocument(space.systemAction(), parentId);
            const documentContent = parentDoc.content.doc.toJSON();

            // Full structure: title, parent link, promoted headings, content, child section
            // Parent and child links are parsed as mention nodes
            expect(documentContent).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Parent Document"}]},
                    // Parent document link (as mention node)
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Parent document: "},
                            {
                                type: "mention",
                                attrs: {
                                    mention: {
                                        type: "SearchEntity",
                                        entityId: `Document:${grandparentId}`,
                                    },
                                },
                            },
                        ],
                    },
                    // ## Introduction promoted to level 1
                    {
                        type: "heading",
                        attrs: {level: 1},
                        content: [{type: "text", text: "Introduction"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "This is the introduction."}],
                    },
                    // ### Details promoted to level 2
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [{type: "text", text: "Details"}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Here are some details."}]},
                    // Child documents section (## becomes level 2)
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
                                                entityId: `Document:${childId}`,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });
    });

    describe("database handling with test helper", () => {
        test("inline database using toCsvReference is replaced with table content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Use toCsvReference() to create a direct CSV link that will be inlined as a table
            // Don't add database as a child - just reference it inline via toCsvReference()
            const database = new ExportedNotionDatabase("Tasks", [
                ["Name", "Status", "Priority"],
                ["Task 1", "Done", "High"],
                ["Task 2", "In Progress", "Medium"],
            ]);
            const doc = new ExportedNotionDocument(
                "Project Overview",
                `Here is the project task list:\n\n${database.toCsvReference()}\n\nAnd here\u2019s some more content.`,
            );

            // Export both items separately - the database is not a child of the doc
            const zipData = createTestNotionImportZip([doc, database]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the document
            let docId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Project Overview")) {
                        docId = documentInfo.id;
                        break;
                    }
                }
            }

            expect(docId).not.toBeNull();
            const document = await getDocument(space.systemAction(), docId!);
            const documentContent = document.content.doc.toJSON();

            // Title should be correct
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Project Overview"}],
            });

            // Get all paragraphs and verify specific text content
            const paragraphs = documentContent.content.filter(
                (node: {type: string}) => node.type === "paragraph",
            );
            const paragraphTexts = paragraphs.map(
                (p: {content?: Array<{text?: string}>}) => p.content?.[0]?.text,
            );

            // Verify paragraphs around the table exist
            expect(paragraphTexts).toContain("Here is the project task list:");
            expect(paragraphTexts.some((t: string) => t?.includes("some more content"))).toBe(true);

            // With toCsvReference(), the CSV link is replaced with inline table content
            const table = documentContent.content.find(
                (node: {type: string}) => node.type === "table",
            );
            expect(table).toBeDefined();
            expect(table.content).toHaveLength(3); // Header + 2 data rows

            // Helper to extract text from a table cell
            const getCellText = (cell: {content: Array<{content: Array<{text: string}>}>}) =>
                cell.content[0]?.content[0]?.text;

            // Verify header row
            const headerRow = table.content[0];
            expect(getCellText(headerRow.content[0])).toBe("Name");
            expect(getCellText(headerRow.content[1])).toBe("Status");
            expect(getCellText(headerRow.content[2])).toBe("Priority");

            // Verify data rows
            expect(getCellText(table.content[1].content[0])).toBe("Task 1");
            expect(getCellText(table.content[1].content[1])).toBe("Done");
            expect(getCellText(table.content[2].content[0])).toBe("Task 2");
            expect(getCellText(table.content[2].content[1])).toBe("In Progress");
        });

        test("child database becomes its own document and parent links to it as mention", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // When a database is a child of a document in Notion exports, Notion creates a .md
            // file for the database that links to the CSV. The parent document links to the
            // .md file (not the CSV directly). So the database becomes its own document and
            // the parent has a mention link.
            const database = new ExportedNotionDatabase("Tasks", [
                ["Name", "Status", "Priority"],
                ["Task 1", "Done", "High"],
                ["Task 2", "In Progress", "Medium"],
            ]);
            const doc = new ExportedNotionDocument(
                "Project Overview",
                `Here is the project task list:\n\n${database.toReference()}\n\nAnd here\u2019s some more content.`,
                [database],
            );

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the parent document and database document
            let parentDocId: DocumentId | null = null;
            let dbMdDocId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Project Overview")) {
                        parentDocId = documentInfo.id;
                    } else if (path.includes("Tasks") && path.endsWith(".md")) {
                        dbMdDocId = documentInfo.id;
                    }
                }
            }

            expect(parentDocId).not.toBeNull();
            const parentDoc = await getDocument(space.systemAction(), parentDocId!);
            const parentContent = parentDoc.content.doc.toJSON();

            // Verify title
            expect(parentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Project Overview"}],
            });

            // Parent document should have:
            //
            // - A mention link to the database .md document
            // - The body content
            // - A "Child documents" section (since database is a child)
            const parentJson = JSON.stringify(parentContent);
            expect(parentJson).toContain("Here is the project task list:");
            expect(parentJson).toContain(dbMdDocId!); // Link to database
            expect(parentJson).toContain("some more content");
            expect(parentJson).toContain("Child documents"); // Child section

            // The database .md file becomes its own document with table content (the .md
            // file's CSV link is converted to an inline table) Since it's a child of "Project
            // Overview", it also has a parent link
            expect(dbMdDocId).not.toBeNull();
            const dbDoc = await getDocument(space.systemAction(), dbMdDocId!);
            const dbContent = dbDoc.content.doc.toJSON();

            // Verify title
            expect(dbContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Tasks"}],
            });

            // Verify parent link exists as mention to parent document
            const parentParagraph = dbContent.content.find(
                (n: {type: string; content?: Array<{type: string; text?: string}>}) =>
                    n.type === "paragraph" &&
                    n.content?.some(c => c.type === "text" && c.text === "Parent document: "),
            );
            expect(parentParagraph).toBeDefined();
            expect(parentParagraph.content).toContainEqual({
                type: "mention",
                attrs: {mention: {type: "SearchEntity", entityId: `Document:${parentDocId}`}},
            });

            // Also verify the table has the expected rows
            const tableNode = dbContent.content.find((n: {type: string}) => n.type === "table");
            expect(tableNode).toBeDefined();
            expect(tableNode.content).toHaveLength(3); // Header + 2 data rows
        });

        test("top-level database becomes its own document with table content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a top-level database (not embedded in a document)
            const database = new ExportedNotionDatabase("Team Members", [
                ["Name", "Role", "Department"],
                ["Alice", "Engineer", "Product"],
                ["Bob", "Designer", "Product"],
                ["Carol", "Manager", "Operations"],
            ]);

            const zipData = createTestNotionImportZip([database]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the database .md document
            let dbMdDocId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Team Members") && path.endsWith(".md")) {
                        dbMdDocId = documentInfo.id;
                        break;
                    }
                }
            }

            expect(dbMdDocId).not.toBeNull();
            const document = await getDocument(space.systemAction(), dbMdDocId!);
            const documentContent = document.content.doc.toJSON();

            // Full-page database becomes a document with title from .md wrapper and table
            // content (the .md file's CSV link is converted to an inline table) Verify title
            // exists
            expect(documentContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Team Members"}],
            });

            // Verify table exists with expected rows
            const tableNode = documentContent.content.find(
                (n: {type: string}) => n.type === "table",
            );
            expect(tableNode).toBeDefined();
            expect(tableNode.content).toHaveLength(4); // Header + 3 data rows

            // Verify the table content by checking JSON contains expected values
            const tableJson = JSON.stringify(tableNode);
            expect(tableJson).toContain("Name");
            expect(tableJson).toContain("Role");
            expect(tableJson).toContain("Department");
            expect(tableJson).toContain("Alice");
            expect(tableJson).toContain("Engineer");
            expect(tableJson).toContain("Bob");
            expect(tableJson).toContain("Designer");
            expect(tableJson).toContain("Carol");
            expect(tableJson).toContain("Manager");
            expect(tableJson).toContain("Operations");
        });

        test("document with database child and regular child document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with both a database child and a regular document child
            const database = new ExportedNotionDatabase("Sprint Tasks", [
                ["Task", "Points"],
                ["Feature A", "5"],
                ["Bug fix", "2"],
            ]);
            const childDoc = new ExportedNotionDocument("Sprint Notes", "Notes about the sprint.");
            const mainDoc = new ExportedNotionDocument(
                "Sprint 42",
                `## Overview

This is sprint 42.

## Tasks

${database.toReference()}

## Summary

Sprint completed successfully.`,
                [database, childDoc],
            );

            const zipData = createTestNotionImportZip([mainDoc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find all documents
            let mainDocId: DocumentId | null = null;
            let dbMdDocId: DocumentId | null = null;
            let notesDocId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Sprint 42") && path.endsWith(".md")) {
                        mainDocId = documentInfo.id;
                    } else if (path.includes("Sprint Tasks") && path.endsWith(".md")) {
                        dbMdDocId = documentInfo.id;
                    } else if (path.includes("Sprint Notes")) {
                        notesDocId = documentInfo.id;
                    }
                }
            }

            expect(mainDocId).not.toBeNull();
            expect(dbMdDocId).not.toBeNull();
            expect(notesDocId).not.toBeNull();

            const document = await getDocument(space.systemAction(), mainDocId!);
            const documentContent = document.content.doc.toJSON();

            // Main document should have: title, headings/content, mention link to database,
            // child docs section
            expect(documentContent).toMatchObject({
                type: "doc",
                content: expect.arrayContaining([
                    {type: "title", content: [{type: "text", text: "Sprint 42"}]},
                    // ## Overview promoted to # (level 1)
                    {
                        type: "heading",
                        attrs: {level: 1},
                        content: [{type: "text", text: "Overview"}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "This is sprint 42."}]},
                    // ## Tasks promoted to # (level 1)
                    {type: "heading", attrs: {level: 1}, content: [{type: "text", text: "Tasks"}]},
                    // ## Summary promoted to # (level 1)
                    {
                        type: "heading",
                        attrs: {level: 1},
                        content: [{type: "text", text: "Summary"}],
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Sprint completed successfully."}],
                    },
                    // Child documents section
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [{type: "text", text: "Child documents"}],
                    },
                ]),
            });

            // Verify the database .md document has table content (the .md file's CSV link is
            // converted to an inline table) It also has a parent link since it's a child of
            // "Sprint 42"
            const dbDoc = await getDocument(space.systemAction(), dbMdDocId!);
            const dbDocContent = dbDoc.content.doc.toJSON();

            // Verify title
            expect(dbDocContent.content[0]).toMatchObject({
                type: "title",
                content: [{type: "text", text: "Sprint Tasks"}],
            });

            // Verify parent link exists
            const dbDocJson = JSON.stringify(dbDocContent);
            expect(dbDocJson).toContain("Parent document:");

            // Verify the table has expected content
            const tableNode = dbDocContent.content.find((n: {type: string}) => n.type === "table");
            expect(tableNode).toBeDefined();
            const tableJson = JSON.stringify(tableNode);
            expect(tableJson).toContain("Task");
            expect(tableJson).toContain("Points");
            expect(tableJson).toContain("Feature A");
            expect(tableJson).toContain("Bug fix");
        });

        test("database with child documents has cells converted to links", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a database with rows containing names that match child document titles In
            // Notion, database items are child documents of the database
            const database = new ExportedNotionDatabase("Team Members", [
                ["Name", "Role"],
                ["Alice", "Engineer"],
                ["Bob", "Designer"],
                ["Carol", "Manager"], // Carol has no corresponding document
            ]);

            // Create a parent document that has the database as a child The database items
            // (Alice, Bob) become children of the database
            const aliceDoc = new ExportedNotionDocument("Alice", "Alice\u2019s profile");
            const bobDoc = new ExportedNotionDocument("Bob", "Bob\u2019s profile");
            const parentDoc = new ExportedNotionDocument("Team", "Team info", [database]);

            // Set the database items to be children of the database by using setParent Since
            // ExportedNotionDatabase doesn't support addChildren, we need to use the
            // createTestMappedReferencesResult helper to set up this relationship manually

            const zipData = createTestNotionImportZip([parentDoc, aliceDoc, bobDoc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            // Manually set up the database-child relationship in mappedResult Find the
            // database .md document and child document IDs
            let dbPath: string | null = null;
            let aliceDocId: DocumentId | null = null;
            let bobDocId: DocumentId | null = null;
            let alicePath: string | null = null;
            let bobPath: string | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Team Members") && path.endsWith(".md")) {
                        dbPath = path;
                    } else if (path.includes("Alice")) {
                        aliceDocId = documentInfo.id;
                        alicePath = path;
                    } else if (path.includes("Bob")) {
                        bobDocId = documentInfo.id;
                        bobPath = path;
                    }
                }
            }

            // Set up the parent-child relationship: database is parent of Alice and Bob
            if (dbPath && alicePath && bobPath) {
                const teamspace = mappedResult.teamspaces[0]!;
                const dbDoc = teamspace.documents[dbPath]!;
                const aliceEntry = teamspace.documents[alicePath]!;
                const bobEntry = teamspace.documents[bobPath]!;

                dbDoc.children.add(aliceDocId!);
                dbDoc.children.add(bobDocId!);
                aliceEntry.parent = {documentId: dbDoc.id, relativeFilePath: dbPath};
                bobEntry.parent = {documentId: dbDoc.id, relativeFilePath: dbPath};
            }

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the database .md document ID
            let dbDocId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Team Members") && path.endsWith(".md")) {
                        dbDocId = documentInfo.id;
                    }
                }
            }

            expect(dbDocId).not.toBeNull();
            expect(aliceDocId).not.toBeNull();
            expect(bobDocId).not.toBeNull();

            const dbDoc = await getDocument(space.systemAction(), dbDocId!);
            const docJson = JSON.stringify(dbDoc.content.doc.toJSON());

            // Alice and Bob cells should be converted to links (containing their document IDs)
            expect(docJson).toContain(aliceDocId);
            expect(docJson).toContain(bobDocId);
            // Carol should remain as plain text (not a link)
            expect(docJson).toContain("Carol");
        });

        test("inline database children have parent link to grandparent, not in children section", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

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

            // Parent references the database inline
            const parent = new ExportedNotionDocument(
                "Project",
                `Team members:\n\n${database.toCsvReference()}`,
                [database],
            );

            const zipData = createTestNotionImportZip([parent]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the document IDs
            let parentDocId: DocumentId | null = null;
            let aliceDocId: DocumentId | null = null;
            let bobDocId: DocumentId | null = null;
            for (const teamspace of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(teamspace.documents)) {
                    if (path.includes("Project")) {
                        parentDocId = documentInfo.id;
                    } else if (path.includes("Alice")) {
                        aliceDocId = documentInfo.id;
                    } else if (path.includes("Bob")) {
                        bobDocId = documentInfo.id;
                    }
                }
            }

            expect(parentDocId).not.toBeNull();
            expect(aliceDocId).not.toBeNull();
            expect(bobDocId).not.toBeNull();

            // Verify parent document does NOT have "Child documents" section (inline database
            // children should only appear as table cell links)
            const parentDoc = await getDocument(space.systemAction(), parentDocId!);
            const parentJson = JSON.stringify(parentDoc.content.doc.toJSON());
            expect(parentJson).not.toContain("Child documents");

            // Verify parent has the table with team data
            expect(parentJson).toContain("table");
            expect(parentJson).toContain("Name");
            expect(parentJson).toContain("Role");

            // Verify Alice has "Parent document" link back to the Project (grandparent)
            const aliceDocument = await getDocument(space.systemAction(), aliceDocId!);
            const aliceJson = JSON.stringify(aliceDocument.content.doc.toJSON());
            expect(aliceJson).toContain("Parent document");
            expect(aliceJson).toContain(parentDocId);

            // Verify Bob has "Parent document" link back to the Project (grandparent)
            const bobDocument = await getDocument(space.systemAction(), bobDocId!);
            const bobJson = JSON.stringify(bobDocument.content.doc.toJSON());
            expect(bobJson).toContain("Parent document");
            expect(bobJson).toContain(parentDocId);
        });
    });

    describe("real Notion export fixtures", () => {
        function readFixture(name: string): Uint8Array {
            const runfiles = process.env.RUNFILES;
            const base = runfiles ? join(runfiles, "cyberworlds") : ".";
            return new Uint8Array(
                readFileSync(join(base, "server/importer/notion/test_fixtures", name)),
            );
        }

        test("JJ-Test-Flat.zip imports all documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const zipData = readFixture("JJ-Test-Flat.zip");
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const progressState = stateManagerFromResult({
                notionImportId,
                context: space.systemAction(),
                mappedResult,
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                progressState,
            );

            // Count total documents from the mapped result. This includes regular documents +
            // root-level CSV database documents + teamspace roots.
            let totalDocuments = 0;
            for (const teamspace of mappedResult.teamspaces) {
                totalDocuments += Object.keys(teamspace.documents).length;
            }
            // Add CSV database documents (synthetic documents created for them)
            totalDocuments += mappedResult.rootLevelCsvDatabases.size;
            totalDocuments += mappedResult.csvDatabasesRequiringDocuments.size;
            // Add teamspace root documents
            totalDocuments += mappedResult.teamspaces.length;

            let totalImported = 0;
            for (const [, counters] of progressState.teamspaceCounters) {
                totalImported += counters.documents;
            }
            expect(totalImported).toBe(totalDocuments);
            expect(totalDocuments).toBeGreaterThan(0);

            // Verify each document can be fetched, has content, and can be serialized
            for (const teamspace of mappedResult.teamspaces) {
                for (const [, documentInfo] of Object.entries(teamspace.documents)) {
                    const document = await getDocument(space.systemAction(), documentInfo.id);
                    expect(document).toBeDefined();
                    expect(document.content.doc.childCount).toBeGreaterThan(0);

                    // Verify the content can be serialized (this triggers schema validation)
                    expect(() => {
                        DocumentContentSchema.serialize(document.content.doc);
                    }).not.toThrow();
                }
            }
        });

        test("Workspace-Flat.zip imports all documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const zipData = readFixture("Workspace-Flat.zip");
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const progressState = stateManagerFromResult({
                notionImportId,
                context: space.systemAction(),
                mappedResult,
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                progressState,
            );

            // Count total documents from the mapped result. This includes regular documents +
            // root-level CSV database documents + teamspace roots.
            let totalDocuments = 0;
            for (const teamspace of mappedResult.teamspaces) {
                totalDocuments += Object.keys(teamspace.documents).length;
            }
            // Add CSV database documents (synthetic documents created for them)
            totalDocuments += mappedResult.rootLevelCsvDatabases.size;
            totalDocuments += mappedResult.csvDatabasesRequiringDocuments.size;
            // Add teamspace root documents
            totalDocuments += mappedResult.teamspaces.length;

            let totalImported = 0;
            for (const [, counters] of progressState.teamspaceCounters) {
                totalImported += counters.documents;
            }
            expect(totalImported).toBe(totalDocuments);
            expect(totalDocuments).toBeGreaterThan(0);

            // Verify each document can be fetched, has content, and can be serialized
            for (const teamspace of mappedResult.teamspaces) {
                for (const [, documentInfo] of Object.entries(teamspace.documents)) {
                    const document = await getDocument(space.systemAction(), documentInfo.id);
                    expect(document).toBeDefined();
                    expect(document.content.doc.childCount).toBeGreaterThan(0);

                    // Verify the content can be serialized (this triggers schema validation)
                    expect(() => {
                        DocumentContentSchema.serialize(document.content.doc);
                    }).not.toThrow();
                }
            }
        });
    });

    describe("teamspace root document", () => {
        test("only includes top-level documents (documents with no parent)", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const topLevelId = generateId<DocumentId>();
            const childId = generateId<DocumentId>();

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );
            const mappedResult = await createTestMappedReferencesResult({
                teamspaces: [
                    {
                        id: "ts1",
                        name: "Test Teamspace",
                        importOption: {type: "Private"},
                        documents: [
                            {
                                filePath: "TopLevel abc12345678901234567890abcdef123.md",
                                id: topLevelId,
                                markdown: "# TopLevel\n\nTop level content.",
                                childIds: [childId],
                            },
                            {
                                filePath: "Child def12345678901234567890abcdef123.md",
                                id: childId,
                                markdown: "# Child\n\nChild content.",
                                parentId: topLevelId,
                            },
                        ],
                    },
                ],
            });

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // The teamspace root document has title "WorkspaceName | TeamspaceName" Find it by
            // checking all documents created in the space The root should contain a link to
            // TopLevel but NOT to Child
            const topLevelDoc = await getDocument(space.systemAction(), topLevelId);
            const topLevelJson = JSON.stringify(topLevelDoc.content.doc.toJSON());

            // Child should NOT be in the teamspace root, so let's verify the child document
            // has a parent link to TopLevel
            const childDoc = await getDocument(space.systemAction(), childId);
            const childJson = JSON.stringify(childDoc.content.doc.toJSON());
            expect(childJson).toContain("Parent document:");
            expect(childJson).toContain(topLevelId);

            // Top-level documents should have a "Parent document:" link to the teamspace root
            // document.
            expect(topLevelJson).toContain("Parent document:");
        });

        test("root documents have parent link to teamspace root document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            // Create two top-level documents
            const doc1 = new ExportedNotionDocument("Document One", "Content one");
            const doc2 = new ExportedNotionDocument("Document Two", "Content two");

            // Create with teamspace
            const teamspace = new ExportedNotionTeamspace("Engineering", [doc1, doc2]);

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const zipData = createTestNotionImportZip([teamspace]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the document IDs
            let doc1Id: DocumentId | null = null;
            let doc2Id: DocumentId | null = null;
            for (const ts of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(ts.documents)) {
                    if (path.includes("Document One")) doc1Id = documentInfo.id;
                    if (path.includes("Document Two")) doc2Id = documentInfo.id;
                }
            }
            expect(doc1Id).not.toBeNull();
            expect(doc2Id).not.toBeNull();

            // Helper to extract parent mention ID from document content
            const extractParentMentionId = (content: any): string | null => {
                for (const node of content.content) {
                    if (node.type === "paragraph" && node.content) {
                        for (const child of node.content) {
                            if (child.type === "mention" && child.attrs?.mention?.entityId) {
                                // entityId is like "Document:abc123"
                                return child.attrs.mention.entityId.replace("Document:", "");
                            }
                        }
                    }
                }
                return null;
            };

            // Both documents should have "Parent document:" mentions
            const doc1Content = await getDocument(space.systemAction(), doc1Id!);
            const doc1Data = doc1Content.content.doc.toJSON();
            const doc1Json = JSON.stringify(doc1Data);
            expect(doc1Json).toContain("Parent document:");

            const doc2Content = await getDocument(space.systemAction(), doc2Id!);
            const doc2Data = doc2Content.content.doc.toJSON();
            const doc2Json = JSON.stringify(doc2Data);
            expect(doc2Json).toContain("Parent document:");

            // Both parent links should point to the same document (the teamspace root)
            const parentId1 = extractParentMentionId(doc1Data);
            const parentId2 = extractParentMentionId(doc2Data);
            expect(parentId1).not.toBeNull();
            expect(parentId2).not.toBeNull();
            expect(parentId1).toBe(parentId2);
        });

        test("root-level CSV database creates document with children nested under it", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            // Create child documents for a root-level inline database
            const meeting1 = new ExportedNotionDocument("Weekly 1", "Meeting notes");
            const meeting2 = new ExportedNotionDocument("Weekly 2", "More notes");

            // Create a root-level inline database (CSV-only) with children
            const meetingDatabase = new ExportedNotionDatabase(
                "Meetings",
                [
                    ["Title", "Date"],
                    ["Weekly 1", "2024-01-01"],
                    ["Weekly 2", "2024-01-08"],
                ],
                [meeting1, meeting2],
                {inline: true},
            );

            // Also create a regular document at root level
            const homeDocument = new ExportedNotionDocument("Home", "Home page content");

            // Create with teamspace
            const teamspace = new ExportedNotionTeamspace("Engineering", [
                meetingDatabase,
                homeDocument,
            ]);

            const {notionImportId, importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const zipData = createTestNotionImportZip([teamspace]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the document IDs
            let homeId: DocumentId | null = null;
            let meeting1Id: DocumentId | null = null;
            let meeting2Id: DocumentId | null = null;
            for (const ts of mappedResult.teamspaces) {
                for (const [path, documentInfo] of Object.entries(ts.documents)) {
                    if (path.includes("Home")) homeId = documentInfo.id;
                    if (path.includes("Weekly 1")) meeting1Id = documentInfo.id;
                    if (path.includes("Weekly 2")) meeting2Id = documentInfo.id;
                }
            }
            expect(homeId).not.toBeNull();
            expect(meeting1Id).not.toBeNull();
            expect(meeting2Id).not.toBeNull();

            // Helper to extract parent mention ID from document content
            const extractParentMentionId = (content: any): string | null => {
                for (const node of content.content) {
                    if (node.type === "paragraph" && node.content) {
                        for (const child of node.content) {
                            if (child.type === "mention" && child.attrs?.mention?.entityId) {
                                // entityId is like "Document:abc123"
                                return child.attrs.mention.entityId.replace("Document:", "");
                            }
                        }
                    }
                }
                return null;
            };

            // Home document should have parent = teamspace root
            const homeDoc2 = await getDocument(space.systemAction(), homeId!);
            const homeData = homeDoc2.content.doc.toJSON();
            const homeJson = JSON.stringify(homeData);
            expect(homeJson).toContain("Parent document:");

            // Meeting documents should have parent = Meetings database document
            const meeting1Doc = await getDocument(space.systemAction(), meeting1Id!);
            const meeting1Data = meeting1Doc.content.doc.toJSON();
            const meeting1Json = JSON.stringify(meeting1Data);
            expect(meeting1Json).toContain("Parent document:");

            // Both meetings should have the same parent (the Meetings database doc)
            const meeting2Doc = await getDocument(space.systemAction(), meeting2Id!);
            const meeting2Data = meeting2Doc.content.doc.toJSON();
            const meeting2Json = JSON.stringify(meeting2Data);
            expect(meeting2Json).toContain("Parent document:");

            // Extract parent IDs from meetings using mention structure
            const meetingParentId1 = extractParentMentionId(meeting1Data);
            const meetingParentId2 = extractParentMentionId(meeting2Data);
            expect(meetingParentId1).not.toBeNull();
            expect(meetingParentId2).not.toBeNull();
            expect(meetingParentId1).toBe(meetingParentId2);

            // Meeting parent should be different from Home parent (Meetings database vs
            // teamspace root)
            const homeParentId = extractParentMentionId(homeData);
            expect(homeParentId).not.toBeNull();
            expect(meetingParentId1).not.toBe(homeParentId);

            // Find and verify the database document has cell links to child documents The
            // database document ID is the parent of the meetings
            const dbDocId = meetingParentId1;
            const dbDoc = await getDocument(space.systemAction(), dbDocId as DocumentId);
            const dbJson = JSON.stringify(dbDoc.content.doc.toJSON());

            // The database document should contain mentions to the child documents in table
            // cells
            expect(dbJson).toContain(meeting1Id);
            expect(dbJson).toContain(meeting2Id);
            // Mentions are parsed, so check for mention type instead of URL string
            // eslint-disable-next-line cyberworlds/string-quotes
            expect(dbJson).toContain('"type":"mention"');

            // Verify there's a table element
            expect(dbJson).toContain("type");
            expect(dbJson).toContain("table");
        });

        test("hierarchy from real unzip function results in correct parent fields", async () => {
            // This test uses the real reference mapping flow to verify that the parent field
            // is correctly set
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create parent-child hierarchy using test helpers
            const child = new ExportedNotionDocument("Child Page", "Child content here.");
            const parent = new ExportedNotionDocument("Parent Page", "Parent content here.", [
                child,
            ]);
            const topLevel = new ExportedNotionDocument("Top Level", "Top level content.");

            const zipData = createTestNotionImportZip([parent, topLevel]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            // Verify the parent field is set correctly in the mapped result
            const docs = Object.entries(mappedResult.teamspaces[0]!.documents);
            const parentDoc = docs.find(([path]) => path.includes("Parent Page"));
            const childDoc = docs.find(([path]) => path.includes("Child Page"));
            const topLevelDoc = docs.find(([path]) => path.includes("Top Level"));

            expect(parentDoc).toBeDefined();
            expect(childDoc).toBeDefined();
            expect(topLevelDoc).toBeDefined();

            // Parent should have no parent (it's top-level)
            expect(parentDoc![1].parent).toBeNull();

            // Child should have parent set to the parent document's ID
            expect(childDoc![1].parent?.documentId).toBe(parentDoc![1].id);

            // Top Level should have no parent (it's also top-level)
            expect(topLevelDoc![1].parent).toBeNull();

            // Count how many documents have parent === null (should be 2: Parent and Top
            // Level)
            const topLevelCount = docs.filter(([, doc]) => doc.parent === null).length;
            expect(topLevelCount).toBe(2);
        });
    });

    describe("file row handling", () => {
        test("image link is converted to fileRow with file node", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with an attached image
            const image = new ExportedNotionFile("screenshot.png", "image");
            const doc = new ExportedNotionDocument(
                "Document with Image",
                `Here is an image:\n\n${image.toReference()}`,
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Document with Image"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Document with Image"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Here is an image:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("video link is converted to fileRow with file node", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with an attached video
            const video = new ExportedNotionFile("demo.mp4", "video");
            const doc = new ExportedNotionDocument(
                "Document with Video",
                `Check out this video:\n\n${video.toReference()}`,
            );
            doc.addFiles([video]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Document with Video"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Document with Video"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Check out this video:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("multiple adjacent files are combined into single fileRow (max 3)", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with three images
            const image1 = new ExportedNotionFile("img1.png", "image");
            const image2 = new ExportedNotionFile("img2.png", "image");
            const image3 = new ExportedNotionFile("img3.png", "image");
            const doc = new ExportedNotionDocument(
                "Gallery",
                `Gallery:\n\n${image1.toReference()}\n${image2.toReference()}\n${image3.toReference()}`,
            );
            doc.addFiles([image1, image2, image3]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Gallery"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Gallery"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Gallery:"}]},
                    {
                        type: "fileRow",
                        content: [
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                        ],
                    },
                ],
            });
        });

        test("more than 3 adjacent files create multiple fileRows", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with five images
            const image1 = new ExportedNotionFile("img1.png", "image");
            const image2 = new ExportedNotionFile("img2.png", "image");
            const image3 = new ExportedNotionFile("img3.png", "image");
            const image4 = new ExportedNotionFile("img4.png", "image");
            const image5 = new ExportedNotionFile("img5.png", "image");
            const doc = new ExportedNotionDocument(
                "Large Gallery",
                `Gallery:\n\n${image1.toReference()}\n${image2.toReference()}\n${image3.toReference()}\n${image4.toReference()}\n${image5.toReference()}`,
            );
            doc.addFiles([image1, image2, image3, image4, image5]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Large Gallery"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            // 5 images should create 2 fileRows: first with 3, second with 2
            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Large Gallery"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Gallery:"}]},
                    {
                        type: "fileRow",
                        content: [
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                        ],
                    },
                ],
            });
        });

        test("files separated by text create separate fileRows", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with images separated by text
            const image1 = new ExportedNotionFile("before.png", "image");
            const image2 = new ExportedNotionFile("after.png", "image");
            const doc = new ExportedNotionDocument(
                "Before and After",
                `Before:\n\n${image1.toReference()}\n\nSome text in between.\n\nAfter:\n\n${image2.toReference()}`,
            );
            doc.addFiles([image1, image2]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Before and After"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Before and After"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Before:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Some text in between."}]},
                    {type: "paragraph", content: [{type: "text", text: "After:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("deterministic file IDs are generated consistently", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with an image
            const image = new ExportedNotionFile("consistent.png", "image");
            const doc = new ExportedNotionDocument(
                "Consistent Doc",
                `Image:\n\n${image.toReference()}`,
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);

            // Import twice and verify the file IDs are the same
            const mappedResult1 = await unzipAndMapReferencesForTest(zipData, importItem);
            const fileIds1 = Object.values(mappedResult1.filesToUpload).map(f => f.id);

            const mappedResult2 = await unzipAndMapReferencesForTest(zipData, importItem);
            const fileIds2 = Object.values(mappedResult2.filesToUpload).map(f => f.id);

            // File IDs should be consistent across imports of the same content
            expect(fileIds1).toEqual(fileIds2);
        });

        test("mixed media types in single document", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document with different media types
            const image = new ExportedNotionFile("photo.png", "image");
            const video = new ExportedNotionFile("clip.mp4", "video");
            const audio = new ExportedNotionFile("song.mp3", "audio");
            const doc = new ExportedNotionDocument(
                "Mixed Media",
                `Image:\n\n${image.toReference()}\n\nVideo:\n\n${video.toReference()}\n\nAudio:\n\n${audio.toReference()}`,
            );
            doc.addFiles([image, video, audio]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Mixed Media"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Mixed Media"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "Image:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Video:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "Audio:"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("multiple media files in a table cell get their own fileRowTable elements", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create files that will be placed alongside the database in nested mode
            const image1 = new ExportedNotionFile("image1.png", "image");
            const image2 = new ExportedNotionFile("image2.png", "image");
            const image3 = new ExportedNotionFile("image3.png", "image");

            // Create a database with a "Files & media" column containing file paths In Notion
            // exports, file paths in CSVs are relative to the grandparent directory and
            // include the parent folder name. So for files in Parent Doc/, paths are
            // "Parent%20Doc/filename" (URL-encoded).
            const database = new ExportedNotionDatabase("Media Database", [
                ["Name", "Files & media"],
                [
                    "Item 1",
                    "Parent%20Doc/image1.png, Parent%20Doc/image2.png, Parent%20Doc/image3.png",
                ],
            ]);

            // Create a parent document that holds both the database and files In nested mode,
            // files are placed in the document's folder alongside child items
            const parentDoc = new ExportedNotionDocument("Parent Doc", "", [database]);
            parentDoc.addFiles([image1, image2, image3]);

            // Use nested mode so the database and files are in the same directory
            const zipData = createTestNotionImportZip([parentDoc], {
                createFoldersForSubpages: true,
            });

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the database document (the one with a table)
            const docEntry = Array.from(mappedResult.pathToDocumentId.entries()).find(([path]) =>
                path.includes("Media Database"),
            );
            expect(docEntry).toBeDefined();

            const document = await getDocument(space.systemAction(), docEntry![1]);

            // The document should contain a table with fileRowTable elements in the data cell
            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Media Database"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "table",
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
                                                content: [{type: "text", text: "Name"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Files & media"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Data row with fileRowTable elements
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Item 1"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });

        test("database with file paths in any column converts them to fileRowTable elements", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();
            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create files that will be placed alongside the database in nested mode
            const sunset = new ExportedNotionFile("sunset.png", "image");
            const beach = new ExportedNotionFile("beach.png", "image");
            const mountain = new ExportedNotionFile("mountain.png", "image");

            // Create a database with file paths in a column that is NOT "Files & media" to
            // verify that file detection works for any column name. In Notion exports, file
            // paths in CSVs are relative to the grandparent directory and include the parent
            // folder name. So for files in Parent Doc/, paths are "Parent%20Doc/filename"
            // (URL-encoded).
            const database = new ExportedNotionDatabase("Project Files", [
                ["Title", "Attachments", "Status"],
                ["Doc A", "Parent%20Doc/sunset.png", "Active"],
                ["Doc B", "Parent%20Doc/beach.png, Parent%20Doc/mountain.png", "Pending"],
            ]);

            // Create a parent document that holds both the database and files In nested mode,
            // files are placed in the document's folder alongside child items
            const parentDoc = new ExportedNotionDocument("Parent Doc", "", [database]);
            parentDoc.addFiles([sunset, beach, mountain]);

            // Use nested mode so the database and files are in the same directory
            const zipData = createTestNotionImportZip([parentDoc], {
                createFoldersForSubpages: true,
            });

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            // Find the database document
            const docEntry = Array.from(mappedResult.pathToDocumentId.entries()).find(([path]) =>
                path.includes("Project Files"),
            );
            expect(docEntry).toBeDefined();

            const document = await getDocument(space.systemAction(), docEntry![1]);

            // The document should contain a table with fileRowTable elements in data cells
            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Project Files"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "table",
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
                                                content: [{type: "text", text: "Attachments"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Status"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Data row 1 (Doc A) - single file
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Doc A"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Active"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            // Data row 2 (Doc B) - two files
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Doc B"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Pending"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });

        test("image in a paragraph is extracted as fileRow", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const image = new ExportedNotionFile("photo.png", "image");
            const doc = new ExportedNotionDocument(
                "Paragraph Image",
                `some text\n\n${image.toReference()}\n\nmore text`,
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Paragraph Image"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Paragraph Image"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {type: "paragraph", content: [{type: "text", text: "some text"}]},
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {type: "paragraph", content: [{type: "text", text: "more text"}]},
                ],
            });
        });

        test("image inside a blockquote is extracted as fileRow", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const image = new ExportedNotionFile("screenshot.png", "image");
            const doc = new ExportedNotionDocument(
                "Quote with Image",
                `> a note about the image\n>\n> ${image.toReference()}`,
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Quote with Image"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Quote with Image"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "quoteBlock",
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "a note about the image"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("images inside ordered lists, unordered lists, and checklists are extracted as fileRows", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const ulImage = new ExportedNotionFile("bullet.png", "image");
            const olImage = new ExportedNotionFile("numbered.png", "image");
            const clImage = new ExportedNotionFile("task.png", "image");
            const doc = new ExportedNotionDocument(
                "All List Types",
                [
                    `- bullet item`,
                    ``,
                    `    ${ulImage.toReference()}`,
                    ``,
                    `1. numbered item`,
                    ``,
                    `    ${olImage.toReference()}`,
                    ``,
                    `- [ ] task item`,
                    ``,
                    `    ${clImage.toReference()}`,
                ].join("\n"),
            );
            doc.addFiles([ulImage, olImage, clImage]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("All List Types"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "All List Types"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "bullet item"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 0, orderStart: null},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "numbered item"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                    {
                        type: "checkListItem",
                        attrs: {indent: 0, checked: false},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "task item"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("image inside list item is extracted as fileRow", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Create a document where an image is nested inside a list item. In Notion exports
            // this is common: a bullet with a prompt followed by an indented image result. The
            // 4-space indent puts the image inside the list item when parsed by the markdown
            // parser.
            const image = new ExportedNotionFile("result.png", "image");
            const doc = new ExportedNotionDocument(
                "Prompts with Images",
                `- a prompt describing an image\n\n    ${image.toReference()}`,
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Prompts with Images"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Prompts with Images"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "a prompt describing an image"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("multiple images inside list items are extracted as fileRows", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // Simulates a Notion page with prompts and image results, like:
            //
            // - prompt one ![img1](img1.png)
            // - prompt two ![img2](img2.png) ![img3](img3.png)
            const image1 = new ExportedNotionFile("img1.png", "image");
            const image2 = new ExportedNotionFile("img2.png", "image");
            const image3 = new ExportedNotionFile("img3.png", "image");
            const doc = new ExportedNotionDocument(
                "Multiple Prompt Results",
                [
                    `- first prompt`,
                    ``,
                    `    ${image1.toReference()}`,
                    ``,
                    `- second prompt`,
                    ``,
                    `    ${image2.toReference()}`,
                    ``,
                    `    ${image3.toReference()}`,
                ].join("\n"),
            );
            doc.addFiles([image1, image2, image3]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Multiple Prompt Results"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {
                        type: "title",
                        content: [{type: "text", text: "Multiple Prompt Results"}],
                    },
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "first prompt"}],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "second prompt"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                            {type: "file", attrs: {fileId: expect.any(String)}},
                        ],
                    },
                ],
            });
        });

        test("image inside list item with text-only items keeps list structure", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            // A list where only some items have images. The list should be preserved with its
            // text items, and the images extracted.
            const image = new ExportedNotionFile("photo.png", "image");
            const doc = new ExportedNotionDocument(
                "Partial Image List",
                [
                    `- text only item`,
                    `- item with image`,
                    ``,
                    `    ${image.toReference()}`,
                    ``,
                    `- another text item`,
                ].join("\n"),
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Partial Image List"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Partial Image List"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "text only item"}],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "item with image"}],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "another text item"}],
                            },
                        ],
                    },
                    {
                        type: "fileRow",
                        content: [{type: "file", attrs: {fileId: expect.any(String)}}],
                    },
                ],
            });
        });

        test("image inside a markdown table cell becomes a fileRowTable in the cell", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const {importItem} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            const image = new ExportedNotionFile("chart.png", "image");
            const doc = new ExportedNotionDocument(
                "Table with Image",
                [`| Name | Preview |`, `| --- | --- |`, `| Chart | ${image.toReference()} |`].join(
                    "\n",
                ),
            );
            doc.addFiles([image]);

            const zipData = createTestNotionImportZip([doc]);
            const mappedResult = await unzipAndMapReferencesForTest(zipData, importItem);

            const {notionImportId} = await createTestNotionImportItemInDatabase(
                context,
                space.id,
                session.account.id,
            );

            await convertExtractedNotionDataToEntities(
                space.systemAction(),
                notionImportId,
                importItem,
                mappedResult,
                stateManagerFromResult({
                    notionImportId,
                    context: space.systemAction(),
                    mappedResult,
                }),
            );

            const docEntry = Object.entries(mappedResult.teamspaces[0]!.documents).find(([path]) =>
                path.includes("Table with Image"),
            );
            const document = await getDocument(space.systemAction(), docEntry![1].id);

            expect(document.content.doc.toJSON()).toMatchObject({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Table with Image"}]},
                    {
                        type: "paragraph",
                        content: expect.arrayContaining([
                            {type: "text", text: "Parent document: "},
                        ]),
                    },
                    {
                        type: "table",
                        content: [
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Name"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Preview"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "tableRow",
                                content: [
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "paragraph",
                                                content: [{type: "text", text: "Chart"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "tableCell",
                                        content: [
                                            {
                                                type: "fileRowTable",
                                                content: [
                                                    {
                                                        type: "file",
                                                        attrs: {fileId: expect.any(String)},
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });
    });
});
