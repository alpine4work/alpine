import {ApiAccount} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

export type ApiAccountMockOptions = {
    id?: AccountId;
    name?: string;
    botId?: BotId;
};

export function createApiAccountMock({id, name, botId}: ApiAccountMockOptions): ApiAccount {
    const account = createTestAccountModel({
        id,
        name,
        botId,
    });
    return intoApiAccount(omitObject(account.initialData, ["avatar"]));
}
