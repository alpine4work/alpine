import {parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible} from "~/shared/api/content/parse_api_content_from_markdown_url_if_possible.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

test("returns null for invalid URL", () => {
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible("not a url"),
    ).toBeNull();
});

test("returns null for non-alpine.inc host", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://example.com/file/${fileId}`,
        ),
    ).toBeNull();
});

test("returns null for non-https protocol", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `http://alpine.inc/file/${fileId}`,
        ),
    ).toBeNull();
});

test("returns null for legacy space file URL", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/s/${generateId()}/files/${fileId}`,
        ),
    ).toBeNull();
});

test("parses file content URL", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/file/${fileId}/content`,
        ),
    ).toEqual({type: "File", file: {id: fileId}});
});

test("returns null for file URL without content suffix", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/file/${fileId}`,
        ),
    ).toBeNull();
});

test("returns null for plural file content URL", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/files/${fileId}/content`,
        ),
    ).toBeNull();
});

test("returns null for file URL with extra path segments", () => {
    const fileId = generateChronologicalId<FileId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/file/${fileId}/extra`,
        ),
    ).toBeNull();
});

test("returns null for file URL with non-id fileId", () => {
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/file/not-an-id`,
        ),
    ).toBeNull();
});

test("parses document preview URL", () => {
    const documentId = generateId<DocumentId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/doc/${documentId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Document", id: documentId}});
});

test("parses channel preview URL", () => {
    const channelId = generateId<ChannelId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/channel/${channelId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Channel", id: channelId}});
});

test("parses chat preview URL", () => {
    const chatId = generateId<ChatId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/chat/${chatId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Chat", id: chatId}});
});

test("parses post preview URL", () => {
    const postId = generateId<PostId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/post/${postId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Post", id: postId}});
});

test("parses site preview URL", () => {
    const siteId = generateId<SiteId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/site/${siteId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Site", id: siteId}});
});

test("parses task preview URL", () => {
    const taskId = generateId<TaskId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/task/${taskId}/preview`,
        ),
    ).toEqual({type: "Preview", reference: {type: "Task", id: taskId}});
});

test("parses task collection preview URL", () => {
    const taskCollectionId = generateId<TaskCollectionId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/task-collection/${taskCollectionId}/preview`,
        ),
    ).toEqual({
        type: "Preview",
        reference: {type: "TaskCollection", id: taskCollectionId},
    });
});

test("returns null for preview URL without /preview path", () => {
    const documentId = generateId<DocumentId>();
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/doc/${documentId}`,
        ),
    ).toBeNull();
});

test("returns null for preview URL with unknown entity type", () => {
    expect(
        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
            `https://alpine.inc/unknown/${generateId<DocumentId>()}/preview`,
        ),
    ).toBeNull();
});
