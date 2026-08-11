import {
    chatGptKnownBotId,
    claudeKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {parseSimpleContentFromMarkdown} from "~/shared/api/content/closed_source/parse_simple_content_from_markdown.js";
import {BotSettingsSchema} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContent} from "~/shared/content/simple_content_schema.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

export type KnownBotSettings = {
    readonly description: SimpleContent;
    readonly schema: BotSettingsSchema;
};

// IMPORTANT: Whenever you update these settings you must run the
// `UpdateKnownBotSettings` migration in production after the change has been
// deployed.
//
// TODO(calebmer, 2026-01-22): Someday, I'd like to automate migration runs after a
// successful deploy. We should be able to detect when this changes and
// automatically run a migration to update production.
export const knownBotSettings = new Lazy((): Record<BotId, KnownBotSettings> => {
    return {
        [chatGptKnownBotId]: {
            description: parseSimpleContentFromMarkdown(`\
ChatGPT is an AI assistant created by OpenAI. ChatGPT can help you with whatever you\u2019re
working on in Alpine.

Want to use your own OpenAI API key? Let us know: [feedback@alpine.inc](mailto:feedback@alpine.inc)
`),
            schema: {properties: emptyMap},
        },
        [claudeKnownBotId]: {
            description: parseSimpleContentFromMarkdown(`\
Claude is an AI assistant created by Anthropic. Claude can help you with whatever you\u2019re
working on in Alpine.
`),
            schema: {
                properties: new Map([
                    [
                        "apiKey",
                        {
                            type: "String",
                            level: "Space",
                            label: "API key",
                            hint: "Get a key from Anthropic\u2019s Claude Console",
                            placeholder:
                                "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                            isCode: true,
                            isSecret: true,
                        },
                    ],
                    [
                        "model",
                        {
                            type: "Select",
                            level: "Space",
                            label: "Model",
                            hint: "The Claude model used for responses",
                            defaultValue: "claude-sonnet-5",
                            options: [
                                {label: "Fable 5", value: "claude-fable-5"},
                                {label: "Opus 5", value: "claude-opus-5"},
                                {label: "Sonnet 5", value: "claude-sonnet-5"},
                                {label: "Haiku 4.5", value: "claude-haiku-4-5"},
                            ],
                        },
                    ],
                    [
                        "effort",
                        {
                            type: "Select",
                            level: "Space",
                            label: "Effort",
                            hint: "Higher means more thorough, but takes longer",
                            defaultValue: "high",
                            options: [
                                {label: "Low", value: "low"},
                                {label: "Medium", value: "medium"},
                                {label: "High", value: "high"},
                                {label: "Extra", value: "xhigh"},
                                {label: "Max", value: "max"},
                            ],
                        },
                    ],
                ]),
            },
        },
        [cursorKnownBotId]: {
            description: parseSimpleContentFromMarkdown(`\
Edit and run code with Cursor Cloud Agents. You can work with Cursor like any other software
engineer in Alpine.

Mention Cursor from anywhere to launch a new Cloud Agent. Reply to one of Cursor\u2019s messages to add a
follow-up for the Cloud Agent.

Start by setting up Cursor Cloud Agents in [Cursor\u2019s web dashboard](https://cursor.com/dashboard?tab=cloud-agents).
`),
            schema: {
                properties: new Map([
                    [
                        "cloudAgentApiKey",
                        {
                            type: "String",
                            level: "Space",
                            label: "Cloud Agents API key",
                            hint: "Create key in Cursor\u2019s web dashboard",
                            placeholder:
                                "key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                            isCode: true,
                            isSecret: true,
                        },
                    ],
                    [
                        "accountCloudAgentApiKey",
                        {
                            type: "String",
                            level: "SpaceAccount",
                            label: "Personal Cloud Agents API key",
                            hint: "Override default API key for your agents (optional)",
                            placeholder:
                                "key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                            isCode: true,
                            isSecret: true,
                        },
                    ],
                    [
                        "githubRepositoryUrl",
                        {
                            type: "String",
                            level: "Space",
                            label: "GitHub repository URL",
                            hint: "e.g. https://github.com/your-org/your-repo",
                            placeholder: "https://github.com/your-org/your-repo",
                            isCode: false,
                            isSecret: false,
                        },
                    ],
                ]),
            },
        },
    };
});
