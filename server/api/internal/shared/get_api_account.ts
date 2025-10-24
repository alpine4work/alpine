import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getAccountWithoutAvatar} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ApiAccount} from "~/shared/api/types/api_specification_convenience_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

export async function getApiAccount(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ApiAccount> {
    const account = await getAccountWithoutAvatar(context, spaceId, accountId, options);
    return intoApiAccount(account);
}

function intoApiAccount(account: Omit<AccountModelData, "avatar">): ApiAccount {
    return {
        id: account.id,
        name: account.name,
        shortName: getAccountShortNameWithoutFullNameTooltip(account),
        botId: account.botId,
        space: {
            role: account.space.role,
            addedTime: serializeDateString(account.space.addedTime),
            inactive:
                account.space.state.type === "Active"
                    ? undefined
                    : account.space.state.type === "InvitePending"
                    ? {type: "InvitePending"}
                    : {
                          type: "Removed",
                          removedTime: serializeDateString(account.space.state.removedTime),
                      },
        },
    };
}
