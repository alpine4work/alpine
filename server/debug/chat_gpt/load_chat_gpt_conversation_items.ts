import {Parser} from "@lezer/common";
import {highlightCode} from "@lezer/highlight";
import {parser as lezerHtmlParser} from "@lezer/html";
import {parser as lezerJsonParser} from "@lezer/json";
import {parser as lezerMarkdownParser, parseCode as parseLezerMarkdownCode} from "@lezer/markdown";
import escapeHtml from "escape-html";
import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
// @ts-expect-error: After upgrading Prettier, we need to directly import
// `prettier/index.mjs` to make sure we don't get the standalone build.
// However, there's no blessed way from Prettier to import the full version
// with types.
import * as prettier from "prettier/index.mjs";
import {chatGptKnownBotId} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {ApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {
    ChatGptConversationItem,
    ChatGptConversationStateResponseSchema,
} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function loadChatGptConversationItems(
    unauthenticatedContext: LoaderContext,
    spaceId: SpaceId,
    roomPath: ApiMessageRoomPath,
): Promise<ReadonlyArray<ChatGptConversationItem>> {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const [, chatGptAccountId] = await runAllPromises([
        // Safety check: Make sure the actor has access to the space.
        authorizeSpaceAccess(context, spaceId),

        getBotAccountIdForSpaceIfExists(context, chatGptKnownBotId, spaceId),
    ]);

    if (!chatGptAccountId)
        throw new FailedPreconditionError("ChatGPT bot wasn\u2019t instantiated in this space");

    const accessToken =
        await context.loader.tokenAgent.privateSide.dangerouslySignShortLivedTokenForBotConversationState(
            {
                type: "Bot",
                spaceId,
                accountId: chatGptAccountId,
                // VERY IMPORTANT: Use the actor `AccountId` as the scope so we only see stuff the
                // actor has access to. If we use the `Chat` as the scope we're implicitly granting
                // access to the chat to any actor who tries to open this page!
                //
                // TODO(ifitzsimmons, #ai): Write an integration test to make sure permissions work
                // properly.
                scope: {type: "Account", accountId: context.actor.getAccountId()},
            },
        );

    const agentServiceUrl = assertExists(
        context.loader.agentServiceUrl,
        "Can\u2019t debug agents if `agentServiceUrl` isn\u2019t set",
    );

    const url = new URL(`${agentServiceUrl}/chat-gpt/conversation-state`);
    url.searchParams.set("accountId", chatGptAccountId);
    url.searchParams.set("roomPath", roomPath);
    url.searchParams.set("accessToken", accessToken);

    const conversationState = await fetchWithTracer(
        context.tracer.getRoot(),
        url,
        {
            serviceName: "AgentService",
            route: "/chat-gpt/conversation-state",
        },
        async response => {
            const result = ChatGptConversationStateResponseSchema.deserialize(
                await response.json(),
            );
            if (!result.ok) throw result.error;
            return result;
        },
    );

    const itemsWithContentHtml = await runAllPromises(
        conversationState.items.map(async item => {
            let tokenCount: number | undefined;

            let content: {
                text: string;
                prettierParser: prettier.BuiltInParserName;
                lezerParser: Parser;
            } | null = null;

            switch (item.type) {
                case "message": {
                    let text = "";

                    for (const content of item.content) {
                        if (content.type === "input_text" || content.type === "output_text") {
                            text += content.text;
                        }
                    }

                    tokenCount = countO200kBaseTokens(text);

                    content = {
                        text,
                        prettierParser: "markdown",
                        lezerParser: lezerMarkdownParser.configure(
                            parseLezerMarkdownCode({htmlParser: lezerHtmlParser}),
                        ),
                    };
                    break;
                }
                case "function_call": {
                    content = {
                        text: item.arguments,
                        prettierParser: "json",
                        lezerParser: lezerJsonParser,
                    };
                    break;
                }
                case "function_call_output": {
                    // TODO(ifitzsimmons, #ai): As of OpenAI API v6, function calls can return a list
                    // of items, including images, files, and text content. We don't currently support
                    // these types of function call outputs -- all of our tool calls return strings.
                    // However, we do have plans to support these types of function calls in the future
                    // and when we do, we'll need to update this logic.
                    assert(
                        typeof item.output === "string",
                        "Function call output must be a string",
                    );
                    tokenCount = countO200kBaseTokens(item.output);

                    content = {
                        text: item.output,
                        prettierParser: "markdown",
                        lezerParser: lezerMarkdownParser.configure(
                            parseLezerMarkdownCode({htmlParser: lezerHtmlParser}),
                        ),
                    };
                    break;
                }
            }

            if (!content) return item;

            // Technically `_world_` below isn't italicized if you're following the CommonMark
            // spec. Since text on an adjacent line to HTML is considered more HTML.
            //
            // ```
            // <human name="Alice>
            // Hello, _world_!
            // </human>
            // ```
            //
            // In the following `_world_` is properly italicized:
            //
            // ```
            // <human name="Alice>
            //
            // Hello, _world_!
            //
            // </human>
            // ```
            //
            // The following adds extra newlines next to HTML open/close tags so Prettier and
            // Lezer (which are sticklers for valid syntax) parse our Markdown correctly.
            if (content.prettierParser === "markdown") {
                content.text = content.text
                    .replaceAll(/^<[a-z]+[^>]*>\n\n?/gm, substring =>
                        !substring.endsWith("\n\n") ? `${substring}\n` : substring,
                    )
                    .replaceAll(/\n\n?<\/[a-z]+[^>]*>$/gm, substring =>
                        !substring.startsWith("\n\n") ? `\n${substring}` : substring,
                    );
            }

            const contentPrettyText = await prettier.format(content.text, {
                parser: content.prettierParser,
                printWidth: 80,
                tabWidth: 2,
                proseWrap: "always",
            });

            let contentHtml = "";

            highlightCode(
                contentPrettyText,
                content.lezerParser.parse(contentPrettyText),
                lezerClassHighlighter.get(),
                (text: string, classes: string) => {
                    if (classes.length === 0) {
                        contentHtml += escapeHtml(text);
                    } else {
                        contentHtml += `<span class="${classes}">${escapeHtml(text)}</span>`;
                    }
                },
                () => {
                    contentHtml += "\n";
                },
            );

            // Convert:
            //
            // ```
            // <human name="Alice>
            //
            // Hello, _world_!
            //
            // </human>
            // ```
            //
            // ...back into our unofficial but more readable syntax:
            //
            // ```
            // <human name="Alice>
            // Hello, _world_!
            // </human>
            // ```
            if (content.prettierParser === "markdown") {
                contentHtml = contentHtml
                    .replaceAll(
                        /<span class="tok-punctuation">&lt;<\/span>.*?<span class="tok-punctuation">&gt;<\/span>\n\n/g,
                        substring => substring.slice(0, -1),
                    )
                    .replaceAll(
                        /\n\n<span class="tok-punctuation">&lt;\/<\/span>.*?<span class="tok-punctuation">&gt;<\/span>/g,
                        substring => substring.slice(1),
                    );
            }

            return {...item, tokenCount, contentHtml};
        }),
    );

    return itemsWithContentHtml;
}
