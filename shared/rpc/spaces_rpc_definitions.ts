import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceAccountSettingsSchema} from "~/shared/spaces/space_account_settings.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export const expensivelyGetAllSpaceAccounts = defineRpc({
    name: "expensivelyGetAllSpaceAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
    },
});

export const createAlphaSpaceAsAdmin = defineRpc({
    name: "createAlphaSpaceAsAdmin",
    input: {
        name: Schema.string,
        ownerAccountId: Schema.id<AccountId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        welcomeChannelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
    },
});

export const dangerouslyAddSpaceAccountAsAdmin = defineRpc({
    name: "dangerouslyAddSpaceAccountAsAdmin",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {},
});

export const removeSpaceAccountAsAdmin = defineRpc({
    name: "removeSpaceAccountAsAdmin",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {},
});

export const getOurAccountSpaces = defineRpc({
    name: "getOurAccountSpaces",
    input: {},
    output: {
        spaces: Schema.array(
            Schema.object({
                space: SpaceModel.schema(),
                inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()).nullable(),
            }),
        ),
    },
});

export const updateSpaceAccountSettings = defineRpc({
    name: "updateSpaceAccountSettings",
    input: {
        spaceId: Schema.id<SpaceId>(),
        update: SpaceAccountSettingsSchema.partial(),
    },
    output: {},
});

export const updateSpaceName = defineRpc({
    name: "updateSpaceName",
    input: {
        spaceId: Schema.id<SpaceId>(),
        name: Schema.string,
    },
    output: {
        space: SpaceModel.schema(),
    },
});
