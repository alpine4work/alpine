import {AvatarThemeSchema} from "~/shared/avatar/avatar_schema.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {AccountId, AvatarId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceAccountSettingsSchema} from "~/shared/spaces/space_account_settings.js";
import {SpaceModel, SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export const expensivelyGetAllSpaceAccounts = defineRpc({
    name: "expensivelyGetAllSpaceAccounts",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        accounts: Schema.array(AccountModel.schema),
    },
});

export const createAlphaSpaceAsAdmin = defineRpc({
    name: "createAlphaSpaceAsAdmin",
    input: {
        name: Schema.string,
        ownerAccountId: Schema.id<AccountId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        welcomeChannelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
    },
});

export const removeSpaceAccount = defineRpc({
    name: "removeSpaceAccount",
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
    input: {
        spaceId: Schema.id<SpaceId>(),
        update: SpaceAccountSettingsSchema.partial(),
    },
    output: {},
});

export const updateSpaceName = defineRpc({
    name: "updateSpaceName",
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
    input: {
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
        role: SpaceRoleSchema,
    },
    output: {account: AccountModel.schema},
});

export const moveSpaceOwner = defineRpc({
    name: "moveSpaceOwner",
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
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const acceptSpaceAccountInvite = defineRpc({
    name: "acceptSpaceAccountInvite",
    input: {
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        account: AccountModel.schema,
    },
});

export const finishUploadingSpaceAvatar = defineRpc({
    name: "finishUploadingSpaceAvatar",
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
    input: {
        name: Schema.string,
    },
    output: {
        space: SpaceModel.schema(),
    },
});

export const instantiateBotSpaceAccount = defineRpc({
    name: "instantiateBotSpaceAccount",
    input: {
        spaceId: Schema.id<SpaceId>(),
        botId: Schema.id<BotId>(),
        accountId: Schema.id<AccountId>().optional(),
    },
    output: {
        accountId: Schema.id<AccountId>(),
        name: Schema.string,
    },
});
