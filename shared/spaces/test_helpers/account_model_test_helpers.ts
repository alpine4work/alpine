import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function createTestAccountModel({
    id = generateId<AccountId>(),
    name = "Test Account",
}: {
    id?: AccountId;
    name?: string;
}) {
    return new AccountModel({
        id,
        name,
        version: 0,
        nameVersion: 0,
        space: {
            version: 0,
            state: {type: "Active"},
            role: "Member",
            addedTime: new Date("2025-01-01T00:00:00Z"),
        },
    });
}
