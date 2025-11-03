import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getAccountWithoutAvatar} from "~/server/spaces/spaces_actions.js";
import {ApiAccount} from "~/shared/api/types/api_specification_convenience_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export async function getApiAccount(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ApiAccount> {
    const account = await getAccountWithoutAvatar(context, spaceId, accountId, options);
    return intoApiAccount(account);
}
