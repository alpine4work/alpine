import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {chatGptKnownBotId} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {
    AgentConversationDebugContentLanguage,
    printAgentConversationDebugContentHtml,
} from "~/server/debug/shared/print_agent_conversation_debug_content_html.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {ApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {
    ChatGptConversationItem,
    ChatGptConversationStateResponseSchema,
} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

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

            let content: {text: string; language: AgentConversationDebugContentLanguage} | null =
                null;

            switch (item.type) {
                case "message": {
                    let text = "";

                    for (const content of item.content) {
                        if (content.type === "input_text" || content.type === "output_text") {
                            text += content.text;
                        }
                    }

                    tokenCount = countO200kBaseTokens(text);

                    content = {text, language: "markdown"};
                    break;
                }
                case "function_call": {
                    content = {text: item.arguments, language: "json"};
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

                    content = {text: item.output, language: "markdown"};
                    break;
                }
            }

            if (!content) return item;

            const contentHtml = await printAgentConversationDebugContentHtml(
                content.text,
                content.language,
            );

            return {...item, tokenCount, contentHtml};
        }),
    );

    return itemsWithContentHtml;
}
