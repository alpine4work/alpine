import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {AccountId, AvatarId, SpaceId} from "~/shared/id/types/id_types.js";
import {ReactionCharacterSchema} from "~/shared/reactions/reaction_character_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const getAccount = defineRpc({
    name: "getAccount",
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountIds: Schema.set(Schema.id<AccountId>()),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
    },
});

export const getAccountsIfExist = defineRpc({
    name: "getAccountsIfExist",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountIds: Schema.set(Schema.id<AccountId>()),
    },
    output: {
        accounts: Schema.array(AccountModel.schema.nullable()),
    },
});

export const updateOurAccountName = defineRpc({
    name: "updateOurAccountName",
    isIdempotent: true,
    input: {
        name: LabelStringSchema,
    },
    output: {
        account: AccountModelWithoutSpace.schema,
    },
});

export const updateOurLastOpenedSpaceId = defineRpc({
    name: "updateOurLastOpenedSpaceId",
    isIdempotent: true,
    input: {
        lastOpenedSpaceId: Schema.id<SpaceId>(),
    },
    output: {},
});

export const updateOurAccountObservedTimeZone = defineRpc({
    name: "updateOurAccountObservedTimeZone",
    isIdempotent: true,
    input: {
        timeZone: TimeZoneSchema,
    },
    output: {},
});

export const getAccountByIdAsAdmin = defineRpc({
    name: "getAccountByIdAsAdmin",
    isIdempotent: true,
    input: {
        accountId: Schema.id<AccountId>(),
    },
    output: {
        account: AccountModelWithoutSpace.schema,
    },
});

export const getAccountByEmailAddressAsAdmin = defineRpc({
    name: "getAccountByEmailAddressAsAdmin",
    isIdempotent: true,
    input: {
        emailAddress: Schema.string,
    },
    output: {
        account: AccountModelWithoutSpace.schema,
    },
});

export const finishUploadingAccountAvatar = defineRpc({
    name: "finishUploadingAccountAvatar",
    isIdempotent: true,
    input: {
        avatarContent: Schema.bytes,
        accountId: Schema.id<AccountId>(),
        avatarId: Schema.id<AvatarId>(),
    },
    output: {
        account: AccountModelWithoutSpace.schema,
    },
});

export const updateAccountReactionCharacter = defineRpc({
    name: "updateAccountReactionCharacter",
    isIdempotent: true,
    input: {
        character: ReactionCharacterSchema,
    },
    output: {
        account: AccountModelWithoutSpace.schema,
    },
});

export const createLifetimeAccessCheckoutUrl = defineRpc({
    name: "createLifetimeAccessCheckoutUrl",
    isIdempotent: false,
    input: {
        currentPathname: Schema.string,
    },
    output: {
        url: Schema.string,
    },
});
