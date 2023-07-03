import {AccountModel} from "~/shared/accounts/account_model.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const getAccountIfExists = defineRpc({
    name: "getAccountIfExists",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {
        account: AccountModel.schema().nullable(),
    },
});

export const getAccounts = defineRpc({
    name: "getAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountIds: Schema.set(Schema.id<AccountId>()),
    },
    output: {
        accounts: Schema.array(AccountModel.schema()),
    },
});
