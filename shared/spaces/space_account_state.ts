import {AccountModelWithoutSpaceAndAvatarDataSchema} from "~/shared/accounts/account_model_without_space.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const SpaceAccountStateRemovedReasons = ["ActionByAdmin", "InviteRejectedAsSpam"] as const;
export type SpaceAccountStateRemovedReason = (typeof SpaceAccountStateRemovedReasons)[number];

export const SpaceAccountStateSchemas = {
    Active: Schema.object({
        type: Schema.value("Active"),
        // NOTE(calebmer, 2026-01-09): This property didn't exist before this date. So
        // default all objects that are missing this property to the migration date.
        activatedTime: Schema.date.default(new Date("2026-01-09T21:17:25.026Z")),
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
