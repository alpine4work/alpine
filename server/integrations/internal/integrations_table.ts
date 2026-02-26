import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SlackWorkspaceSchema} from "~/shared/integrations/slack/slack_space_integration_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const IntegrationsTable = DynamoTableSchema.new({
    name: "Integrations",
    partitions: [
        {
            name: "SlackSpaceIntegration",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "SlackWorkspace",
                    sortKeyAttributes: {
                        workspaceId: DynamoKeyAttributeSchema.labelString<string>(),
                    },
                    attributes: SlackWorkspaceSchema.omit(["workspaceId"]),
                },
                {
                    name: "SlackWorkspaceBot",
                    sortKeyAttributes: {
                        workspaceId: DynamoKeyAttributeSchema.labelString<string>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The bot Slack user ID is used to identify the Alpine bot in a Slack
                         * workspace.
                         */
                        botUserId: Schema.string,
                        /**
                         * The bot token is used to perform bot actions within a slack workspace via
                         * the the Slack API. This is sensitive information and should never be sent
                         * to the client! It allows us to send messages to a Slack workspace on
                         * behalf of our Alpine bot.
                         */
                        botToken: Schema.string,

                        /**
                         * The bot scopes are the permissions the bot has in the Slack workspace.
                         * If these scopes change, the bot token needs to be refreshed.
                         */
                        botScopes: Schema.set(Schema.string),

                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "SlackUser",
                    sortKeyAttributes: {
                        workspaceId: DynamoKeyAttributeSchema.labelString<string>(),
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The Slack user ID is used to identify the user in a Slack workspace.
                         * Slack User IDs should be unique within a Slack workspace.
                         */
                        slackUserId: Schema.string,

                        /**
                         * The display name of the user in the Slack workspace. This is the name
                         * that Slack shows to other users and displays in mentions. Usually this
                         * is set by the user themselves.
                         */
                        displayName: Schema.string.optional(),

                        /**
                         * The real name of the user in the Slack workspace. This is their first
                         * and last name, and may be controlled by their Slack workspace admin.
                         */
                        realName: Schema.string.optional(),

                        /**
                         * The email address of the user in the Slack workspace.
                         */
                        email: Schema.string.optional(),

                        /**
                         * The profile image URL of the user in the Slack workspace. We use the
                         * 512px version of the profile image URL.
                         */
                        profileImageUrl: Schema.string.optional(),

                        connectedTime: Schema.date,
                    }),
                },
            ],
        },
    ],
});

export type SlackWorkspaceIntegrationItem = DynamoTableItemType<
    typeof IntegrationsTable,
    "SlackSpaceIntegration",
    "SlackWorkspace"
>;

export type SlackWorkspaceBotIntegrationItem = DynamoTableItemType<
    typeof IntegrationsTable,
    "SlackSpaceIntegration",
    "SlackWorkspaceBot"
>;

export type SlackUserIntegrationItem = DynamoTableItemType<
    typeof IntegrationsTable,
    "SlackSpaceIntegration",
    "SlackUser"
>;
