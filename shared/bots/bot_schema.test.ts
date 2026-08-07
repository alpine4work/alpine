import {BotWebhookSchema} from "~/shared/bots/bot_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const BotAttributesWebhookSchema = Schema.object({
    webhook: BotWebhookSchema.wrapOriginalPropertyInObject("url", {
        secret: null,
    })
        .originalPropertyKey("webhookUrl")
        .nullable(),
});

test("bot webhook schema deserializes legacy nullable webhook URLs", () => {
    expect(BotAttributesWebhookSchema.deserialize({webhookUrl: null})).toEqual({
        webhook: null,
    });
    expect(
        BotAttributesWebhookSchema.deserialize({
            webhookUrl: "https://example.com/webhook",
        }),
    ).toEqual({
        webhook: {
            url: "https://example.com/webhook",
            secret: null,
        },
    });
    expect(
        BotAttributesWebhookSchema.deserialize({
            webhookUrl: "https://example.com/webhook",
            webhook: {secret: "test-secret"},
        }),
    ).toEqual({
        webhook: {
            url: "https://example.com/webhook",
            secret: "test-secret",
        },
    });
});

test("bot webhook schema serializes URL at the legacy webhook URL property", () => {
    expect(BotAttributesWebhookSchema.serialize({webhook: null})).toEqual({
        webhookUrl: null,
    });
    expect(
        BotAttributesWebhookSchema.serialize({
            webhook: {
                url: "https://example.com/webhook",
                secret: "test-secret",
            },
        }),
    ).toEqual({
        webhookUrl: "https://example.com/webhook",
        webhook: {secret: "test-secret"},
    });
});
