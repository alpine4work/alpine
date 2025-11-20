// For stream parts created before we had the `createdTime` property, use a mock time

import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayloadSchema} from "~/shared/messaging/message_schema.js";
import {Schema} from "~/shared/schema/schema.js";

// smaller than future times.
const MessageStreamPartCreatedTimeSchema = Schema.date.default(
    new Date("2025-11-14T03:54:50.378Z"),
);

export const MessageStreamAttributesSchema = Schema.object({
    // We duplicate `authorId` here to easily check if the bot is allowed to update
    // the stream.
    authorId: Schema.id<AccountId>(),

    /**
     * The time at which the stream was created. This should always be the same
     * as the message's creation time. We set them separately so that we can
     * reliably determine if a stream has timed out without having to fetch
     * the Message's creation time.
     */
    createdTime: Schema.date.default(new Date("2025-11-14T04:24:50.378Z")),

    /**
     * If a stream hasn't been pinged in a certain amount of time, it can indicate
     * that there was a process failure that prevented the stream's completion.
     *
     * Clients can use this data to determine how to handle a stream that seems
     * stale to them.
     *
     * Internally, we'll ping this stream from our agents every 500ms during active
     * LLM requests for 2 reasons.
     *
     * 1. Try to keep the Durable Object alive. See here:
     *    https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0pxh5qjvkttqdnypy0aj67xv98
     * 2. Since we're pinging the stream every 500ms, we can detect a process failure on the
     *    *client side* if there is no completion time and the stream hasn't been pinged for
     *    something like 2 seconds (missed 4 cycles).
     *
     * We'll also set this value any time a new part is created or updated.
     */
    lastPingTime: Schema.date.nullable().default(null),

    /**
     * When the stream was completed. If null then the stream hasn't been
     * finished so we should expect more updates!
     *
     * If a stream hasn't completed for some period of time since creation (a
     * couple hours) then we consider the stream to be completed whether or not
     * it actually has been completed.
     */
    completedTime: Schema.date.nullable(),

    /**
     * The number of parts in the stream so far. A bot can only ever create
     * new parts or update the last part in the stream.
     */
    partCount: Schema.integer.min(0),

    /**
     * The current `updateLockVersion` of the last part in the stream.
     */
    lastPartUpdateLockVersion: Schema.integer.min(0).nullable(),

    /**
     * The last `IndexSearchEntity` job that was sent for this stream. We send an
     * `IndexSearchEntity` job once every 10 seconds.
     */
    lastIndexSearchEntityJob: Schema.object({
        sendTime: Schema.date,
        delaySeconds: Schema.integer.min(0),
    }),

    /**
     * The creation time of the last part of the stream. We allow clients to update
     * stream parts as long as they're updating the last part of the stream or the
     * next part. When they update a part, we don't want to have to fetch the part
     * in order to maintain its creation time.
     *
     * Because we disallow clients from updating existing parts before the last part,
     * we can safely store the creation time of the last part on the Stream's
     * attributes and trust its accuracy. This will get set every time a new stream
     * part is created.
     */
    lastPartCreatedTime: Schema.date.nullable().default(null),
});

export const MessageStreamPartSchema = Schema.object({
    payload: MessageStreamPartPayloadSchema,
    createdTime: MessageStreamPartCreatedTimeSchema,
});
