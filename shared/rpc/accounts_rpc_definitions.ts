import {AccountModel} from "~/shared/accounts/account_model.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const getAccount = defineRpc({
    name: "getAccount",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const getAccounts = defineRpc({
    name: "getAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountIds: Schema.set(Schema.id<AccountId>()),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
    },
});

export const updateSessionActorAccountName = defineRpc({
    name: "updateSessionActorAccountName",
    input: {
        name: LabelStringSchema,
    },
    output: {
        account: AccountModel.schema,
    },
});
