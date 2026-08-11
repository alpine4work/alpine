import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const WebPushSubscriptionSchema = Schema.object({
    endpoint: Schema.string,
    expirationTime: Schema.float.nullable(),
    keys: Schema.object({
        p256dh: Schema.string,
        auth: Schema.string,
    }),
});

export type WebPushSubscription = SchemaType<typeof WebPushSubscriptionSchema>;
