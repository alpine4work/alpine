import {SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const expensivelyGetAllSpaceAccounts = defineRpc({
    name: "expensivelyGetAllSpaceAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        accounts: Schema.array(AccountModel.schema()),
    },
});
