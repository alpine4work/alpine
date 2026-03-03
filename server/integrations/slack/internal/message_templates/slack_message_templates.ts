import {Block, KnownBlock} from "@slack/web-api";
import {slackAccountConnectedSuccessMessage} from "~/server/integrations/slack/internal/message_templates/slack_account_connected_success_message.js";
import {slackAlpineNotificationMessage} from "~/server/integrations/slack/internal/message_templates/slack_alpine_notification_message.js";
import {slackWorkspaceConnectedSuccessMessage} from "~/server/integrations/slack/internal/message_templates/slack_workspace_connected_success_message.js";

export const slackMessageTemplates = {
    SlackWorkspaceConnectedSuccess: slackWorkspaceConnectedSuccessMessage,
    SlackAlpineNotification: slackAlpineNotificationMessage,
    SlackAccountConnectedSuccess: slackAccountConnectedSuccessMessage,
};

export type SlackMessageTemplates = keyof typeof slackMessageTemplates;

export type SlackMessageTemplateArgs<Template extends SlackMessageTemplates> = Parameters<
    (typeof slackMessageTemplates)[Template]
>[0];

type SlackMessageContents = {
    text: string;
    blocks: Array<KnownBlock | Block>;
};

// Mapped type with a uniform return type for each key. Assigning
// `slackMessageTemplates` to this type lets TypeScript treat
// `handlers[templateName]` as a single function type (not a union) when called
// from a generic context, so `templateArgs` type-checks without a cast.
type SlackMessageTemplateHandlers = {
    [K in SlackMessageTemplates]: (args: SlackMessageTemplateArgs<K>) => SlackMessageContents;
};

const slackMessageTemplateHandlers: SlackMessageTemplateHandlers = slackMessageTemplates;

export function generateSlackMessageBodyFromTemplate<Template extends SlackMessageTemplates>(
    templateName: Template,
    templateArgs: SlackMessageTemplateArgs<Template>,
): SlackMessageContents {
    return slackMessageTemplateHandlers[templateName](templateArgs);
}
