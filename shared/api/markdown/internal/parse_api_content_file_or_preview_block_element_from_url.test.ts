import {parseApiContentFileOrPreviewBlockElementFromUrl} from "~/shared/api/markdown/internal/parse_api_content_file_or_preview_block_element_from_url.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();

test("returns null for invalid URL", () => {
    expect(parseApiContentFileOrPreviewBlockElementFromUrl(spaceId, "not a url")).toBeNull();
});

test("returns null for non-alpine.inc host", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://example.com/s/${spaceId}/files/${fileId}`,
        ),
    ).toBeNull();
});

test("returns null for non-https protocol", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `http://alpine.inc/s/${spaceId}/files/${fileId}`,
        ),
    ).toBeNull();
});

test("returns null for wrong spaceId", () => {
    const otherSpaceId = generateId<SpaceId>();
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${otherSpaceId}/files/${fileId}`,
        ),
    ).toBeNull();
});

test("parses file content URL", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/files/${fileId}/content`,
        ),
    ).toEqual({type: "File", id: fileId});
});

test("parses legacy file URL without suffix", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/files/${fileId}`,
        ),
    ).toEqual({type: "File", id: fileId});
});

test("returns null for file URL with extra path segments", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/files/${fileId}/extra`,
        ),
    ).toBeNull();
});

test("returns null for file URL with non-id fileId", () => {
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/files/not-an-id`,
        ),
    ).toBeNull();
});

test("parses document preview URL", () => {
    const documentId = generateId<DocumentId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/documents/${documentId}/preview`,
        ),
    ).toEqual({type: "Preview", target: {type: "Document", id: documentId}});
});

test("parses channel preview URL", () => {
    const channelId = generateId<ChannelId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/channels/${channelId}/preview`,
        ),
    ).toEqual({type: "Preview", target: {type: "Channel", id: channelId}});
});

test("parses chat preview URL", () => {
    const chatId = generateId<ChatId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/chats/${chatId}/preview`,
        ),
    ).toEqual({type: "Preview", target: {type: "Chat", id: chatId}});
});

test("parses post preview URL", () => {
    const postId = generateId<PostId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/posts/${postId}/preview`,
        ),
    ).toEqual({type: "Preview", target: {type: "Post", id: postId}});
});

test("parses task preview URL", () => {
    const taskId = generateId<TaskId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/tasks/${taskId}/preview`,
        ),
    ).toEqual({type: "Preview", target: {type: "Task", id: taskId}});
});

test("parses task collection preview URL", () => {
    const taskCollectionId = generateId<TaskCollectionId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/tasks/collections/${taskCollectionId}/preview`,
        ),
    ).toEqual({
        type: "Preview",
        target: {type: "TaskCollection", id: taskCollectionId},
    });
});

test("returns null for preview URL without /preview path", () => {
    const documentId = generateId<DocumentId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/documents/${documentId}`,
        ),
    ).toBeNull();
});

test("returns null for preview URL with unknown entity type", () => {
    expect(
        parseApiContentFileOrPreviewBlockElementFromUrl(
            spaceId,
            `https://alpine.inc/s/${spaceId}/unknown/${generateId<DocumentId>()}/preview`,
        ),
    ).toBeNull();
});
