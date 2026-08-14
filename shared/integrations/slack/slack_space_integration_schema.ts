import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Represents a Slack workspace that is linked to a space in Alpine. This
 * information is not considered sensitive and can be sent to the client.
 */
export const SlackWorkspaceSchema = Schema.object({
    workspaceId: Schema.string,
    workspaceName: Schema.string,
    workspaceImageUrl: Schema.string.optional(),
    workspaceUrl: Schema.string.optional(),
    connectedTime: Schema.date,
    connectedByAccountId: Schema.id<AccountId>(),
});

export type SlackWorkspace = SchemaType<typeof SlackWorkspaceSchema>;

/**
 * Represents a Slack account that is linked to a space in Alpine. This information
 * is not considered sensitive and can be sent to the client.
 */
export const SlackAccountSchema = Schema.object({
    slackUserId: Schema.string,
    displayName: Schema.string.optional(),
    realName: Schema.string.optional(),
    profileImageUrl: Schema.string.optional(),
});

export type SlackAccount = SchemaType<typeof SlackAccountSchema>;
