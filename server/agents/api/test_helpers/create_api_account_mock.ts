import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

export function createApiAccountMock({
    id,
    name,
    botId,
}: {
    id?: AccountId;
    name?: string;
    botId?: BotId;
}): ApiAccountResponse {
    const account = createTestAccountModel({
        id,
        name,
        botId,
    });
    return intoApiAccount(omitObject(account.initialData, ["avatar"]));
}
