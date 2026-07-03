import {generateId} from "~/shared/id/id.js";
import {ChatId, DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {
    MessageDraftSurface,
    MessageDraftSurfaceSchema,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";

describe("MessageDraftSurface", () => {
    test("round-trips a chat surface through the schema", () => {
        const surface: MessageDraftSurface = {type: "Chat", chatId: generateId<ChatId>()};

        expect(
            MessageDraftSurfaceSchema.deserialize(MessageDraftSurfaceSchema.serialize(surface)),
        ).toEqual(surface);
    });

    test("derives a document comment thread surface key from its two ids", () => {
        const documentId = generateId<DocumentId>();
        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(
            getMessageDraftSurfaceKey({
                type: "DocumentCommentThread",
                documentId,
                commentThreadId,
            }),
        ).toBe(`DocumentCommentThread:${documentId}:${commentThreadId}`);
    });

    test("rejects an unknown surface type", () => {
        expect(() => MessageDraftSurfaceSchema.deserialize({type: "Mystery"})).toThrow();
    });

    test("rejects a chat surface with a malformed id", () => {
        expect(() =>
            MessageDraftSurfaceSchema.deserialize({type: "Chat", chatId: "not-a-real-id"}),
        ).toThrow();
    });
});
