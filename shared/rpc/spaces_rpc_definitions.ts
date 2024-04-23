import {AccountModel} from "~/shared/accounts/account_model.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

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

export const dangerouslyCreateSpaceAccountAsAdmin = defineRpc({
    name: "dangerouslyCreateSpaceAccountAsAdmin",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {},
});
