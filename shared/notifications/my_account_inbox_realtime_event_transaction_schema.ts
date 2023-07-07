import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";

export const MyAccountInboxRealtimeEventTransactionSchema = Schema.object({
    readTime: Schema.date,
    eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(InboxItemModelSchema)),
});
