import {
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeIndexQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxEntryKeySchema, InboxEntryModelSchema} from "~/shared/models/inbox_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getInboxEntries = defineRpc({
    name: "getInboxEntries",
    input: {
        spaceId: Schema.id<SpaceId>(),
        filter: Schema.enum(["New", "Archive"]),
        limit: Schema.integer,
        afterCursor: DynamoIndexCursorSchema.nullable(),
    },
    output: {
        entriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
    },
});

export const backfillInboxEntries = defineRpc({
    name: "backfillInboxEntries",
    input: {
        spaceId: Schema.id<SpaceId>(),
        readTime: Schema.date,
    },
    output: {
        backfillEntriesResult:
            createDynamoGeneralRealtimeBackfillResultSchema(InboxEntryModelSchema),
    },
});

export const archiveInboxEntry = defineRpc({
    name: "archiveInboxEntry",
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});

export const unarchiveInboxEntry = defineRpc({
    name: "unarchiveInboxEntry",
    input: {
        spaceId: Schema.id<SpaceId>(),
        key: InboxEntryKeySchema,
    },
    output: {},
});
