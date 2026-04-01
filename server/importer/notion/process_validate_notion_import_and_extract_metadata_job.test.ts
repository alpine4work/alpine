/* eslint-disable cyberworlds/string-quotes -- Test descriptions may contain apostrophes */
import {readFileSync} from "fs";
import {join} from "path";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {NotionImporterTable} from "~/server/importer/notion/internal/notion_importer_table.js";
import {processValidateNotionImportAndExtractMetadataJob} from "~/server/importer/notion/process_validate_notion_import_and_extract_metadata_job.js";
import {
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";

const context = createTestContext();

/**
 * Create a system action context with a fresh importer module containing the given
 * file.
 */
async function createSystemActionWithFile(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    importKey: string,
    fileData?: Uint8Array,
) {
    const importer = new TestImporterContextModule();
    if (fileData) {
        await importer.setUploadedFile(importKey, fileData);
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

/**
 * Helper to create a ValidateQueued import item and return the IDs needed to run
 * the validation job.
 */
async function createValidateQueuedImport(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    session: Awaited<ReturnType<typeof TestSpace.prototype.createSession>>,
    zip: Uint8Array,
): Promise<{notionImportId: NotionImportId; importKey: string}> {
    const notionImportId = generateId<NotionImportId>();
    const importKey = `${space.id}/Notion/${notionImportId}`;

    await NotionImporterTable.createItem(context, {
        partitionType: "Import",
        sortRangeType: "Attributes",
        notionImportId,
        spaceId: space.id,
        startedByAccountId: session.account.id,
        workspaceName: null,
        importKey,
        createdTime: new Date(),
        updatedTime: new Date(),
        startedProcessingTime: null,
        teamspaceImportOptions: null,
        multipartUploadId: null,
        startedValidatingTime: null,
        status: {type: "ValidateQueued"},
        importedCount: 0,
        importZipSize: zip.byteLength,
    });

    return {notionImportId, importKey};
}

function readFixture(name: string): Uint8Array {
    const runfiles = assertExists(process.env.RUNFILES, "RUNFILES environment variable not set");
    return new Uint8Array(
        readFileSync(join(runfiles, "cyberworlds", "server/importer/notion/test_fixtures", name)),
    );
}

/** Extract the `result` from a Validated status. */
function getValidatedResult(status: {type: string}): NotionImportProcessingOrDoneResult {
    expect(status.type).toBe("Validated");
    return (status as {type: "Validated"; result: NotionImportProcessingOrDoneResult}).result;
}

describe("processValidateNotionImportAndExtractMetadataJob", () => {
    describe("successful validation", () => {
        test("validates a simple document export", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Hello World", "Content here.");
            const zip = createTestNotionImportZip([doc], {workspaceName: "My Workspace"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 1},
                            files: new Map(),
                        },
                    ],
                ]),
            );
        });

        test("extracts workspace name", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc], {workspaceName: "Acme Corp"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.workspaceName).toBe("Acme Corp");

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 1},
                            files: new Map(),
                        },
                    ],
                ]),
            );
        });

        test("counts documents in validated result", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const docs = [
                new ExportedNotionDocument("Doc A", "Content A"),
                new ExportedNotionDocument("Doc B", "Content B"),
                new ExportedNotionDocument("Doc C", "Content C"),
            ];
            const zip = createTestNotionImportZip(docs, {workspaceName: "Test"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 3},
                            files: new Map(),
                        },
                    ],
                ]),
            );
        });

        test("counts nested documents", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const grandchild = new ExportedNotionDocument("Grandchild", "deep content");
            const child = new ExportedNotionDocument("Child", "middle content", [grandchild]);
            const parent = new ExportedNotionDocument("Parent", "top content", [child]);
            const zip = createTestNotionImportZip([parent], {workspaceName: "Nested"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 3},
                            files: new Map(),
                        },
                    ],
                ]),
            );
        });

        test("counts binary files in validated result", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const image = new ExportedNotionFile("photo.png", "image");
            const doc = new ExportedNotionDocument("With Image", `Look: ${image.toReference()}`);
            doc.files.push(image);
            const zip = createTestNotionImportZip([doc], {workspaceName: "Media"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 1},
                            files: new Map([
                                ["image/png", {imported: 0, expectedCount: 1, size: 195534}],
                            ]),
                        },
                    ],
                ]),
            );
        });
    });

    describe("teamspace handling", () => {
        test("creates implicit teamspace when export has no teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "content");
            const zip = createTestNotionImportZip([doc], {workspaceName: "Solo Workspace"});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.teamspaceImportOptions).toHaveLength(1);
            expect(item.teamspaceImportOptions![0]).toMatchObject({
                teamspaceName: "Solo Workspace",
                option: {type: "Public"},
            });

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 1},
                            files: new Map(),
                        },
                    ],
                ]),
            );
        });

        test("detects multiple teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const ts1 = new ExportedNotionTeamspace("Engineering", [page1]);
            const ts2 = new ExportedNotionTeamspace("Marketing", [page2]);
            const zip = createTestNotionImportZip([ts1, ts2]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.teamspaceImportOptions).toHaveLength(2);
            const names = item.teamspaceImportOptions!.map(opt => opt.teamspaceName).sort();
            expect(names).toEqual(["Engineering", "Marketing"]);

            const result = getValidatedResult(item.status);
            const engId = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Engineering",
            )!.teamspaceId;
            const mktId = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Marketing",
            )!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [engId, {documents: {imported: 0, expectedCount: 1}, files: new Map()}],
                    [mktId, {documents: {imported: 0, expectedCount: 1}, files: new Map()}],
                ]),
            );
        });

        test("defaults teamspace containing 'private' to Private", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const page = new ExportedNotionDocument("Page", "");
            const ts = new ExportedNotionTeamspace("My Private Notes", [page]);
            const zip = createTestNotionImportZip([ts]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const privateOpt = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "My Private Notes",
            );
            expect(privateOpt?.option).toEqual({type: "Private"});

            const result = getValidatedResult(item.status);
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        privateOpt!.teamspaceId,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                ]),
            );
        });

        test("defaults teamspace containing 'shared' to Private", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const page = new ExportedNotionDocument("Page", "");
            const ts = new ExportedNotionTeamspace("Private & Shared", [page]);
            const zip = createTestNotionImportZip([ts]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const sharedOpt = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Private & Shared",
            );
            expect(sharedOpt?.option).toEqual({type: "Private"});

            const result = getValidatedResult(item.status);
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        sharedOpt!.teamspaceId,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                ]),
            );
        });

        test("defaults teamspace without private/shared keywords to Public", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const page = new ExportedNotionDocument("Page", "");
            const ts = new ExportedNotionTeamspace("Engineering", [page]);
            const zip = createTestNotionImportZip([ts]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const engOpt = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Engineering",
            );
            expect(engOpt?.option).toEqual({type: "Public"});

            const result = getValidatedResult(item.status);
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        engOpt!.teamspaceId,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                ]),
            );
        });

        test("applies private/shared defaults across mixed teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const page1 = new ExportedNotionDocument("Page 1", "");
            const page2 = new ExportedNotionDocument("Page 2", "");
            const page3 = new ExportedNotionDocument("Page 3", "");
            const ts1 = new ExportedNotionTeamspace("Private & Shared", [page1]);
            const ts2 = new ExportedNotionTeamspace("Engineering", [page2]);
            const ts3 = new ExportedNotionTeamspace("My Private Journal", [page3]);
            const zip = createTestNotionImportZip([ts1, ts2, ts3]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const optionsByName = new Map(
                item.teamspaceImportOptions!.map(opt => [opt.teamspaceName, opt.option]),
            );
            expect(optionsByName.get("Private & Shared")).toEqual({type: "Private"});
            expect(optionsByName.get("Engineering")).toEqual({type: "Public"});
            expect(optionsByName.get("My Private Journal")).toEqual({type: "Private"});

            const result = getValidatedResult(item.status);
            const idByName = new Map(
                item.teamspaceImportOptions!.map(opt => [opt.teamspaceName, opt.teamspaceId]),
            );
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        idByName.get("Private & Shared")!,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                    [
                        idByName.get("Engineering")!,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                    [
                        idByName.get("My Private Journal")!,
                        {documents: {imported: 0, expectedCount: 1}, files: new Map()},
                    ],
                ]),
            );
        });

        test("assigns documents to correct teamspaces in result", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const ts1 = new ExportedNotionTeamspace("Engineering", [
                new ExportedNotionDocument("API Design", "content"),
                new ExportedNotionDocument("Architecture", "content"),
            ]);
            const ts2 = new ExportedNotionTeamspace("Marketing", [
                new ExportedNotionDocument("Campaign", "content"),
            ]);
            const zip = createTestNotionImportZip([ts1, ts2]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(item.status);
            const engId = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Engineering",
            )!.teamspaceId;
            const mktId = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Marketing",
            )!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [engId, {documents: {imported: 0, expectedCount: 2}, files: new Map()}],
                    [mktId, {documents: {imported: 0, expectedCount: 1}, files: new Map()}],
                ]),
            );
        });
    });

    describe("status transitions", () => {
        test("transitions from ValidateQueued to Validated", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            const beforeItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });
            expect(beforeItem.status.type).toBe("ValidateQueued");

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const afterItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            const result = getValidatedResult(afterItem.status);
            const tsId = afterItem.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([[tsId, {documents: {imported: 0, expectedCount: 1}, files: new Map()}]]),
            );
        });

        test("throws FailedPreconditionError when status is not ValidateQueued", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc]);

            const notionImportId = generateId<NotionImportId>();
            const importKey = `${space.id}/Notion/${notionImportId}`;

            // Create with UploadPending instead of ValidateQueued
            await NotionImporterTable.createItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
                spaceId: space.id,
                startedByAccountId: session.account.id,
                workspaceName: null,
                importKey,
                createdTime: new Date(),
                updatedTime: new Date(),
                startedProcessingTime: null,
                teamspaceImportOptions: null,
                multipartUploadId: null,
                startedValidatingTime: null,
                status: {type: "UploadPending"},
                importedCount: 0,
                importZipSize: 1024,
            });

            await expect(
                processValidateNotionImportAndExtractMetadataJob(
                    await createSystemActionWithFile(space, importKey, zip),
                    notionImportId,
                ),
            ).rejects.toThrow("Status is not in the correct state for validation");
        });

        test("updates updatedTime on successful validation", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            const beforeItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const afterItem = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(afterItem.updatedTime.getTime()).toBeGreaterThanOrEqual(
                beforeItem.updatedTime.getTime(),
            );
        });
    });

    describe("failure cases", () => {
        test("fails when import file is not found", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const doc = new ExportedNotionDocument("Page", "");
            const zip = createTestNotionImportZip([doc]);

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            // Don't upload the file — pass no fileData so the import file is missing
            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.status).toMatchObject({
                type: "Failed",
                error: "Import file not found",
                result: {teamspaces: new Map()},
            });
        });

        test("fails when zip contains no index.html", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create a zip with no index.html by using fflate directly
            const {zipSync, strToU8} = await import("fflate");
            const innerFiles = {
                "Export-test/readme.txt": strToU8("Not a Notion export"),
                "Export-test/data.json": strToU8('{"key": "value"}'),
            };
            const innerZip = zipSync(innerFiles);
            const zip = zipSync({"Export-test-Part-1.zip": innerZip});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.status).toMatchObject({
                type: "Failed",
                error: "Invalid Notion export: no index.html found",
                result: {teamspaces: new Map()},
            });
        });

        test("fails when index.html has no workspace name", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            // Create a zip with index.html that has no workspace info
            const {zipSync, strToU8} = await import("fflate");
            const innerFiles = {
                "Export-test/index.html": strToU8(
                    "<html><body><p>No workspace info here</p></body></html>",
                ),
            };
            const innerZip = zipSync(innerFiles);
            const zip = zipSync({"Export-test-Part-1.zip": innerZip});

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.status).toMatchObject({
                type: "Failed",
                error: "Invalid Notion export: could not extract workspace name",
                result: {teamspaces: new Map()},
            });
        });
    });

    describe("real Notion export fixtures", () => {
        test("validates JJ-Test-Flat.zip", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("JJ-Test-Flat.zip");

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.workspaceName).toBe("Export");
            expect(item.teamspaceImportOptions).toHaveLength(1);

            const result = getValidatedResult(item.status);
            const tsId = item.teamspaceImportOptions![0]!.teamspaceId;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        tsId,
                        {
                            documents: {imported: 0, expectedCount: 32},
                            files: new Map([
                                ["video/mp4", {imported: 0, expectedCount: 1, size: 1460340}],
                                ["image/jpeg", {imported: 0, expectedCount: 2, size: 750073}],
                                ["image/png", {imported: 0, expectedCount: 8, size: 1761071}],
                            ]),
                        },
                    ],
                ]),
            );
        });

        test("validates Workspace-Flat.zip with teamspaces", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});

            const zip = readFixture("Workspace-Flat.zip");

            const {notionImportId, importKey} = await createValidateQueuedImport(
                space,
                session,
                zip,
            );

            await processValidateNotionImportAndExtractMetadataJob(
                await createSystemActionWithFile(space, importKey, zip),
                notionImportId,
            );

            const item = await NotionImporterTable.getItem(context, {
                partitionType: "Import",
                sortRangeType: "Attributes",
                notionImportId,
            });

            expect(item.workspaceName).toBe("Alpine Test Space");

            const teamspaceNames = item.teamspaceImportOptions!.map(opt => opt.teamspaceName);
            expect(teamspaceNames).toContain("Private & Shared");

            const privateShared = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Private & Shared",
            );
            expect(privateShared?.option).toEqual({type: "Private"});

            const result = getValidatedResult(item.status);
            const privateSharedOpt = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName === "Private & Shared",
            )!;
            const otherOpt = item.teamspaceImportOptions!.find(
                opt => opt.teamspaceName !== "Private & Shared",
            )!;
            expect(result.teamspaces).toEqual(
                new Map([
                    [
                        otherOpt.teamspaceId,
                        {
                            documents: {imported: 0, expectedCount: 2},
                            files: new Map(),
                        },
                    ],
                    [
                        privateSharedOpt.teamspaceId,
                        {
                            documents: {imported: 0, expectedCount: 15},
                            files: new Map([
                                ["text/markdown", {imported: 0, expectedCount: 1, size: 10}],
                                ["image/png", {imported: 0, expectedCount: 7, size: 1391981}],
                            ]),
                        },
                    ],
                ]),
            );
        });
    });
});
