import {parseFileIdFromApiFileElement} from "~/server/api/internal/shared/parse_file_id_or_file_entity_id.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, DocumentId, FileId, PostId, TaskId} from "~/shared/id/types/id_types.js";

test("extracts FileId from a File element", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(parseFileIdFromApiFileElement({element: {type: "File", id: fileId}})).toBe(fileId);
});

test("extracts Document FileEntityId from a Preview element", () => {
    const documentId = generateId<DocumentId>();
    expect(
        parseFileIdFromApiFileElement({
            element: {
                type: "Preview",
                target: {type: "Document", id: documentId},
            },
        }),
    ).toBe(`Document:${documentId}`);
});

test("extracts Channel FileEntityId from a Preview element", () => {
    const channelId = generateId<ChannelId>();
    expect(
        parseFileIdFromApiFileElement({
            element: {type: "Preview", target: {type: "Channel", id: channelId}},
        }),
    ).toBe(`Channel:${channelId}`);
});

test("extracts Post FileEntityId from a Preview element", () => {
    const postId = generateId<PostId>();
    expect(
        parseFileIdFromApiFileElement({
            rowIndex: 4,
            width: 0.5,
            element: {type: "Preview", target: {type: "Post", id: postId}},
        }),
    ).toBe(`Post:${postId}`);
});

test("extracts Task FileEntityId from a Preview element", () => {
    const taskId = generateId<TaskId>();
    expect(
        parseFileIdFromApiFileElement({
            element: {
                type: "Preview",
                target: {type: "Task", id: taskId},
            },
        }),
    ).toBe(`Task:${taskId}`);
});
