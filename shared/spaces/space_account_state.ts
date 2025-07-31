import {AccountModelWithoutSpaceDataSchema} from "~/shared/accounts/account_model_without_space.js";
import {Schema} from "~/shared/schema/schema.js";

export const spaceAccountStateDefault = {
    type: "Active",
} as const;

export const SpaceAccountStateSchemas = {
    Active: Schema.object({
        type: Schema.value("Active"),
    }),
    Removed: Schema.object({
        type: Schema.value("Removed"),
        removedTime: Schema.date.originalPropertyKey("time"),
        oldAccountData: AccountModelWithoutSpaceDataSchema,
        reason: Schema.enum(["ActionByAdmin", "InviteRejectedAsSpam"]).default("ActionByAdmin"),
    }),
    InvitePending: Schema.object({
        type: Schema.value("InvitePending"),
        invitedTime: Schema.date,
        pendingAccountData: AccountModelWithoutSpaceDataSchema,
    }),
};

export type SpaceAccountStateType = keyof typeof SpaceAccountStateSchemas;
