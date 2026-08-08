import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export async function getApiAccount(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ApiAccountResponse> {
    const account = await getAccountWithoutAvatar(context, spaceId, accountId, options);
    return intoApiAccount(account);
}
