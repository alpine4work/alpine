import {hasMessageInputContent} from "~/client/web/messaging/has_message_input_content.js";
import {
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

describe("hasMessageInputContent()", () => {
    test("returns false for empty content with no parent or files", () => {
        expect(
            hasMessageInputContent({
                contentDoc: emptyMessageContent,
                parent: null,
                fileIds: [],
            }),
        ).toBe(false);
    });

    test("returns true for non-empty content", () => {
        expect(
            hasMessageInputContent({
                contentDoc: createSimpleMessageContent("hello"),
                parent: null,
                fileIds: [],
            }),
        ).toBe(true);
    });

    test("returns true for empty content with a reply target", () => {
        expect(
            hasMessageInputContent({
                contentDoc: emptyMessageContent,
                parent: {type: "Message", index: 2},
                fileIds: [],
            }),
        ).toBe(true);
    });

    test("returns true for empty content with attached files", () => {
        expect(
            hasMessageInputContent({
                contentDoc: emptyMessageContent,
                parent: null,
                fileIds: [generateChronologicalId<FileId>()],
            }),
        ).toBe(true);
    });

    test("returns true when content, reply target, and files are all present", () => {
        expect(
            hasMessageInputContent({
                contentDoc: createSimpleMessageContent("hello"),
                parent: {type: "Message", index: 2},
                fileIds: [generateChronologicalId<FileId>()],
            }),
        ).toBe(true);
    });
});
