import {createDynamoGeneralRealtimeIndexQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxEntryModelSchema} from "~/shared/models/inbox_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getInboxEntries = defineRpc({
    name: "getInboxEntries",
    input: {
        spaceId: Schema.id<SpaceId>(),
        limit: Schema.integer,
        afterCursor: DynamoIndexCursorSchema.nullable(),
    },
    output: {
        entriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
    },
});
