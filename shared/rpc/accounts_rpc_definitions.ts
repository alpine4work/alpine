import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxModel} from "~/shared/models/inbox_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getInboxWithStrongReadConsistency = defineRpc({
    name: "getInboxWithStrongReadConsistency",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
    },
});
