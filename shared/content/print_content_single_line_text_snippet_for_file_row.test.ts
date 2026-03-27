import {printContentSingleLineTextSnippetForFileRow} from "~/shared/content/print_content_single_line_text_snippet_for_file_row.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, FileId} from "~/shared/id/types/id_types.js";

function fileId(contentType: FileContentType): FileId {
    const id = generateChronologicalId<FileId>();
    fileContentTypes.set(id, contentType);
    return id;
}

function fileEntityId(type: "Document"): FileEntityId {
    return `${type}:${generateId<DocumentId>()}`;
}

const fileContentTypes = new Map<FileId, FileContentType>();

function getFileIfExists(id: FileId): {readonly contentType: FileContentType} | null {
    const contentType = fileContentTypes.get(id);
    return contentType ? {contentType} : null;
}

test("single image file", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/png")],
        getFileIfExists,
    );
    expect(parts).toEqual(["Image"]);
});

test("adjacent files of the same type increment a count", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/png"), fileId("image/jpeg"), fileId("image/gif")],
        getFileIfExists,
    );
    expect(parts).toEqual(["Image", "Image 2", "Image 3"]);
});

test("count resets when a different noun appears", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/png"), fileId("video/mp4"), fileId("image/jpeg")],
        getFileIfExists,
    );
    expect(parts).toEqual(["Image", "Video", "Image"]);
});

test("file entity IDs resolve to entity nouns", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [fileEntityId("Document"), fileEntityId("Document")],
        getFileIfExists,
    );
    expect(parts).toEqual(["Document", "Document 2"]);
});

test("null file ID falls back to File noun", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow([null], getFileIfExists);
    expect(parts).toEqual(["File"]);
});

test("unknown file ID falls back to File noun", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [generateChronologicalId<FileId>()],
        () => null,
    );
    expect(parts).toEqual(["File"]);
});

test("state carries across calls", () => {
    const first = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/png"), fileId("image/jpeg")],
        getFileIfExists,
    );
    expect(first.parts).toEqual(["Image", "Image 2"]);

    const second = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/gif")],
        getFileIfExists,
        first.nextState,
    );
    expect(second.parts).toEqual(["Image 3"]);
});

test("state resets across calls when noun changes", () => {
    const first = printContentSingleLineTextSnippetForFileRow(
        [fileId("image/png")],
        getFileIfExists,
    );

    const second = printContentSingleLineTextSnippetForFileRow(
        [fileId("video/mp4")],
        getFileIfExists,
        first.nextState,
    );
    expect(second.parts).toEqual(["Video"]);
});

test("empty file list returns empty parts", () => {
    const {parts, nextState} = printContentSingleLineTextSnippetForFileRow([], getFileIfExists);
    expect(parts).toEqual([]);
    expect(nextState).toBeNull();
});

test("mixed file IDs and file entity IDs", () => {
    const {parts} = printContentSingleLineTextSnippetForFileRow(
        [
            fileId("image/png"),
            fileId("image/jpeg"),
            fileEntityId("Document"),
            fileEntityId("Document"),
            fileId("image/gif"),
        ],
        getFileIfExists,
    );
    expect(parts).toEqual(["Image", "Image 2", "Document", "Document 2", "Image"]);
});
