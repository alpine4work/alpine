import {FeedEntryCursorSchema} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModelSchema} from "~/shared/feed/feed_entry_model.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const getFeedEntries = defineRpc({
    name: "getFeedEntries",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
        afterCursor: FeedEntryCursorSchema.optional(),
    },
    output: {
        endCursor: FeedEntryCursorSchema.nullable(),
        hasMoreEntries: Schema.boolean,
        entries: Schema.array(FeedEntryModelSchema),
    },
});
