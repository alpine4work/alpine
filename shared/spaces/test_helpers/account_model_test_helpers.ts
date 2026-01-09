import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceAndAvatarData,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    AccountModel,
    AccountModelData,
    AccountModelDataSpaceState,
} from "~/shared/spaces/account_model.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

export function createTestAccountModel(accountModelDataOptions: Partial<AccountModelData> = {}) {
    const time = new Date("2025-01-01T00:00:00Z");

    return new AccountModel({
        version: 0,
        nameVersion: 0,
        space: {
            version: 0,
            state: {type: "Active", activatedTime: time},
            role: "Member",
            addedTime: time,
        },
        avatar: null,
        // NOTE(calebmer): This may be called in Playwright which doesn't have a global
        // `expect()` function.
        reactionCharacter: typeof expect === "function" ? expect.any(Object) : null,
        ...accountModelDataOptions,
        id: accountModelDataOptions.id ?? generateId<AccountId>(),
        name: accountModelDataOptions.name ?? "Test Account",
    });
}

export function createTestAccountModelWithoutSpace(
    accountModelDataOptions: Partial<AccountModelData>,
) {
    return new AccountModelWithoutSpace({
        id: accountModelDataOptions.id ?? generateId<AccountId>(),
        name: accountModelDataOptions.name ?? "Test Account",
        version: 0,
        nameVersion: 0,
        avatar: null,
        // NOTE(calebmer): This may be called in Playwright which doesn't have a global
        // `expect()` function.
        reactionCharacter: typeof expect === "function" ? expect.any(Object) : null,
        ...accountModelDataOptions,
    });
}

export function createTestAccountSpaceData(
    options: Partial<{
        version: number;
        addedTime: Date;
        state: AccountModelDataSpaceState;
        role: SpaceRole;
    }> = {},
): {
    version: number;
    addedTime: Date;
    state: AccountModelDataSpaceState;
    role: SpaceRole;
} {
    const time = new Date("2025-01-01T00:00:00Z");

    return {
        version: 0,
        addedTime: time,
        state: {type: "Active", activatedTime: time},
        role: "Member",
        ...options,
    };
}

export function intoAccountModelWithoutSpaceAndAvatar(
    accountData: AccountModelWithoutSpaceData,
): AccountModelWithoutSpaceAndAvatarData {
    return omitObject(accountData, ["avatar"]);
}
