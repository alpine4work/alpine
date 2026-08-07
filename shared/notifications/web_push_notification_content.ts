import webpush from "web-push";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export const WebPushNotificationContentSchema = Schema.object({
    title: Schema.string,
    body: Schema.string,
    urgency: Schema.enum<webpush.Urgency>(["very-low", "low", "normal", "high"]).optional(),
    tag: Schema.string.optional(),
    silent: Schema.boolean.optional(),
    data: Schema.object({
        url: Schema.string.optional(),
    }).optional(),
});

export type WebPushNotificationContent = SchemaType<typeof WebPushNotificationContentSchema>;

export const SendWebPushNotificationOptionsSchema = Schema.object({
    topic: Schema.string.optional(),
    urgency: Schema.enum(["very-low", "low", "normal", "high"]).optional(),
});

export type SendWebPushNotificationOptions = SchemaType<
    typeof SendWebPushNotificationOptionsSchema
>;
