import {AccountModelWithoutSpaceAndAvatarDataSchema} from "~/shared/accounts/account_model_without_space.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const spaceAccountStateDefault = {
    type: "Active",
} as const;

const SpaceAccountStateRemovedReasons = ["ActionByAdmin", "InviteRejectedAsSpam"] as const;
export type SpaceAccountStateRemovedReason = (typeof SpaceAccountStateRemovedReasons)[number];

export const SpaceAccountStateSchemas = {
    Active: Schema.object({
        type: Schema.value("Active"),
    }),
    Removed: Schema.object({
        type: Schema.value("Removed"),
        removedTime: Schema.date.originalPropertyKey("time"),
        oldAccountData: AccountModelWithoutSpaceAndAvatarDataSchema,
        reason: Schema.enum(SpaceAccountStateRemovedReasons).default("ActionByAdmin"),
    }),
    InvitePending: Schema.object({
        type: Schema.value("InvitePending"),
        invitedTime: Schema.date,
        pendingAccountData: AccountModelWithoutSpaceAndAvatarDataSchema,
        wasPreviouslyRemoved: Schema.boolean.default(false),
    }),
};

export type SpaceAccountStateType = keyof typeof SpaceAccountStateSchemas;
export type SpaceAccountState = SchemaType<
    (typeof SpaceAccountStateSchemas)[SpaceAccountStateType]
>;
