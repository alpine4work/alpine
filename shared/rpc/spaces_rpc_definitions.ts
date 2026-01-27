import {AvatarThemeSchema} from "~/shared/avatar/avatar_schema.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {AccountId, AvatarId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceAccountSettingsSchema} from "~/shared/spaces/space_account_settings.js";
import {SpaceModel, SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export const expensivelyGetAllSpaceAccounts = defineRpc({
    name: "expensivelyGetAllSpaceAccounts",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
    },
});

export const createAlphaSpaceAsAdmin = defineRpc({
    name: "createAlphaSpaceAsAdmin",
    // Will create two spaces if called twice.
    isIdempotent: false,
    input: {
        name: Schema.string,
        ownerAccountId: Schema.id<AccountId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
    },
});

export const removeSpaceAccount = defineRpc({
    name: "removeSpaceAccount",
    // Throws if account has already been removed from the space.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const addSpaceAccount = defineRpc({
    name: "addSpaceAccount",
    // Throws if account has already been added to the space.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const getOurAccountSpaces = defineRpc({
    name: "getOurAccountSpaces",
    isIdempotent: true,
    input: {},
    output: {
        spaces: Schema.array(
            Schema.object({
                space: SpaceModel.schema(),
                inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()).nullable(),
            }),
        ),
    },
});

export const updateSpaceAccountSettings = defineRpc({
    name: "updateSpaceAccountSettings",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        update: SpaceAccountSettingsSchema.partial(),
    },
    output: {},
});

export const updateSpaceName = defineRpc({
    name: "updateSpaceName",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        name: Schema.string,
    },
    output: {
        space: SpaceModel.schema(),
    },
});

export const updateSpaceAccountRole = defineRpc({
    name: "updateSpaceAccountRole",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
        role: SpaceRoleSchema,
    },
    output: {account: AccountModel.schema},
});

export const moveSpaceOwner = defineRpc({
    name: "moveSpaceOwner",
    // Can only move owner as the space owner. Once you've moved ownership you
    // can't move ownership again.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        newOwnerAccountId: Schema.id<AccountId>(),
    },
    output: {
        newOwnerAccount: AccountModel.schema,
        oldOwnerAccount: AccountModel.schema,
    },
});

export const inviteEmailAddressesToSpace = defineRpc({
    name: "inviteEmailAddressesToSpace",
    // TODO(calebmer): Pretty sure this isn't idempotent but haven't confirmed. It
    // probably either throws if inviting the same email address again or sends two
    // emails.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        emailAddresses: Schema.array(Schema.string),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
        errors: Schema.object({
            invalidEmailAddresses: Schema.array(Schema.string),
            rejectedAsSpamEmailAddresses: Schema.array(Schema.string),
            alreadyMemberEmailAddresses: Schema.array(Schema.string),
            unexpectedFailureEmailAddresses: Schema.map(Schema.string, ErrorSchema),
        }),
    },
});

export const rejectSpaceAccountInviteAsSpam = defineRpc({
    name: "rejectSpaceAccountInviteAsSpam",
    // Throws an error if invite has already been accepted or rejected.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const acceptSpaceAccountInvite = defineRpc({
    name: "acceptSpaceAccountInvite",
    // Throws an error if invite has already been accepted or rejected.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const finishUploadingSpaceAvatar = defineRpc({
    name: "finishUploadingSpaceAvatar",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        avatarContent: Schema.bytes,
        avatarId: Schema.id<AvatarId>(),
        avatarTheme: AvatarThemeSchema,
    },
    output: {
        space: SpaceModel.schema(),
    },
});

export const createSpace = defineRpc({
    name: "createSpace",
    // Creates two spaces if called twice.
    isIdempotent: false,
    input: {
        name: Schema.string,
    },
    output: {
        space: SpaceModel.schema(),
    },
});

export const instantiateBotSpaceAccount = defineRpc({
    name: "instantiateBotSpaceAccount",
    // Throws an error if bot has already been instantiated in the space.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        botId: Schema.id<BotId>(),
        accountId: Schema.id<AccountId>().optional(),
    },
    output: {
        account: AccountModel.schema,
    },
});
