import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function createTestAccountModel(accountModelDataOptions: Partial<AccountModelData>) {
    return new AccountModel({
        id: accountModelDataOptions.id ?? generateId<AccountId>(),
        name: accountModelDataOptions.name ?? "Test Account",
        version: 0,
        nameVersion: 0,
        space: {
            version: 0,
            state: {type: "Active"},
            role: "Member",
            addedTime: new Date("2025-01-01T00:00:00Z"),
        },
        ...accountModelDataOptions,
    });
}
