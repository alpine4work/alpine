import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Represents a Slack workspace that is linked to a space in Alpine. This information is not
 * considered sensitive and can be sent to the client.
 */
export const SlackWorkspaceSchema = Schema.object({
    workspaceId: Schema.string,
    workspaceName: Schema.string,
    workspaceIcon: Schema.string.optional(),
    connectedTime: Schema.date,
    connectedByAccountId: Schema.id<AccountId>(),
});

export type SlackWorkspace = SchemaType<typeof SlackWorkspaceSchema>;
