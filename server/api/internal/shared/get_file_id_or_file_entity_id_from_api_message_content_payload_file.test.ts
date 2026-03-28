import {getFileIdOrFileEntityIdFromApiMessageContentPayloadFile} from "~/server/api/internal/shared/get_file_id_or_file_entity_id_from_api_message_content_payload_file.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, DocumentId, FileId, PostId, TaskId} from "~/shared/id/types/id_types.js";

test("extracts FileId from a File element", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        getFileIdOrFileEntityIdFromApiMessageContentPayloadFile({
            element: {type: "File", id: fileId},
        }),
    ).toBe(fileId);
});

test("extracts Document FileEntityId from a Preview element", () => {
    const documentId = generateId<DocumentId>();
    expect(
        getFileIdOrFileEntityIdFromApiMessageContentPayloadFile({
            element: {
                type: "Preview",
                reference: {type: "Document", id: documentId},
            },
        }),
    ).toBe(`Document:${documentId}`);
});

test("extracts Channel FileEntityId from a Preview element", () => {
    const channelId = generateId<ChannelId>();
    expect(
        getFileIdOrFileEntityIdFromApiMessageContentPayloadFile({
            element: {type: "Preview", reference: {type: "Channel", id: channelId}},
        }),
    ).toBe(`Channel:${channelId}`);
});

test("extracts Post FileEntityId from a Preview element", () => {
    const postId = generateId<PostId>();
    expect(
        getFileIdOrFileEntityIdFromApiMessageContentPayloadFile({
            rowIndex: 4,
            width: 0.5,
            element: {type: "Preview", reference: {type: "Post", id: postId}},
        }),
    ).toBe(`Post:${postId}`);
});

test("extracts Task FileEntityId from a Preview element", () => {
    const taskId = generateId<TaskId>();
    expect(
        getFileIdOrFileEntityIdFromApiMessageContentPayloadFile({
            element: {
                type: "Preview",
                reference: {type: "Task", id: taskId},
            },
        }),
    ).toBe(`Task:${taskId}`);
});
