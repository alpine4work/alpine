import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {resolveFilesForApiResponse} from "~/server/files/data/resolve_files_for_api_response.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

const context = createTestContext();

test("resolves a file ID to file metadata", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const file = await TestFile.create(session);

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [file.id]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "File",
                id: file.id,
                contentType: "image/png",
                contentLength: expect.any(Number),
            },
        },
    ]);
});

test("resolves a Document FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const documentId = generateId<DocumentId>();
    const entityId: FileEntityId = `Document:${documentId}`;

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [entityId]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "Document", id: documentId},
                title: "Document",
            },
        },
    ]);
});

test("resolves a Channel FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const channelId = generateId<ChannelId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `Channel:${channelId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "Channel", id: channelId},
                title: "Channel",
            },
        },
    ]);
});

test("resolves a Chat FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const chatId = generateId<ChatId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `Chat:${chatId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "Chat", id: chatId},
                title: "Chat",
            },
        },
    ]);
});

test("resolves a Post FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const postId = generateId<PostId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `Post:${postId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "Post", id: postId},
                title: "Post",
            },
        },
    ]);
});

test("resolves a Task FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const taskId = generateId<TaskId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `Task:${taskId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "Task", id: taskId, status: {type: "Closed"}},
                title: "Task",
            },
        },
    ]);
});

test("resolves a TaskCollection FileEntityId to a preview", async () => {
    const space = await TestSpace.create(context);
    const collectionId = generateId<TaskCollectionId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `TaskCollection:${collectionId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 1,
            element: {
                type: "Preview",
                target: {type: "TaskCollection", id: collectionId},
                title: "Task Collection",
            },
        },
    ]);
});

test("skips invalid strings that are not file IDs or entity IDs", async () => {
    const space = await TestSpace.create(context);

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        "not-a-valid-id",
        "also:invalid",
    ]);

    expect(results).toMatchObject([]);
});

test("skips file IDs that don\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const missingFileId = generateChronologicalId<FileId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        missingFileId,
    ]);

    expect(results).toMatchObject([]);
});

test("skips files from a different space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session1 = await space1.createSession();
    const file = await TestFile.create(session1);

    const results = await resolveFilesForApiResponse(space2.systemAction(), space2.id, [file.id]);

    expect(results).toMatchObject([]);
});

test("resolves a mix of file IDs and entity IDs", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const file = await TestFile.create(session);
    const documentId = generateId<DocumentId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        file.id,
        `Document:${documentId}`,
    ]);

    expect(results).toMatchObject([
        {
            rowIndex: 0,
            width: 0.380763,
            element: {type: "File", id: file.id},
        },
        {
            rowIndex: 0,
            width: 0.619237,
            element: {type: "Preview", target: {type: "Document", id: documentId}},
        },
    ]);

    expect(results[0]!.width + results[1]!.width).toBe(1);
});

test("returns empty array for empty input", async () => {
    const space = await TestSpace.create(context);

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, []);

    expect(results).toMatchObject([]);
});

test("skips Site FileEntityId since the API PreviewTarget does not yet include Site", async () => {
    const space = await TestSpace.create(context);
    const siteId = generateId<DocumentId>();

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        `Site:${siteId}`,
    ]);

    expect(results).toMatchObject([
        {
            element: {
                type: "Preview",
                target: {type: "Site", id: siteId},
                title: "Site",
            },
        },
    ]);
});

test("splits files into rows of up to three items and annotates row widths", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const file1 = await TestFile.create(session);
    const file2 = await TestFile.create(session);
    const file3 = await TestFile.create(session);
    const file4 = await TestFile.create(session);

    const results = await resolveFilesForApiResponse(space.systemAction(), space.id, [
        file1.id,
        file2.id,
        file3.id,
        file4.id,
    ]);

    expect(results).toHaveLength(4);
    expect(results.map(result => result.rowIndex)).toEqual([0, 0, 0, 1]);
    expect(results.map(result => result.width)).toEqual([0.333333, 0.333333, 0.333334, 1]);
    expect(results.slice(0, 3).reduce((sum, result) => sum + result.width, 0)).toBe(1);
    expect(results[3]!.width).toBe(1);
});
