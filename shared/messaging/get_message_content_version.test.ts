import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {
    MessageContentPayloadSchema,
    getMessageContentVersion,
} from "~/shared/messaging/message_schema.js";

test("returns 0 for content message payload without content update", () => {
    const payload = MessageContentPayloadSchema.deserialize({
        type: "Content",
        content: createSimpleMessageContent("Hello").toJSON(),
        contentUpdatedTime: null,
        contentUpdate: null,
        fileIds: [],
    });

    expect(getMessageContentVersion(payload)).toBe(0);
});

test("returns mapping count for updated content message payload", () => {
    const payload = MessageContentPayloadSchema.deserialize({
        type: "Content",
        content: createSimpleMessageContent("Hello").toJSON(),
        contentUpdatedTime: new Date().toISOString(),
        contentUpdate: {mappings: [{maps: []}, {maps: []}]},
        fileIds: [],
    });

    expect(getMessageContentVersion(payload)).toBe(2);
});
