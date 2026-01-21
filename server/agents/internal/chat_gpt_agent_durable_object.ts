import OpenAi from "openai";
import {createApiClient, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {
    AgentContext,
    AgentDurableObjectBase,
    AgentWebhookRequest,
} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentMaxTokenCountPerWebhookCall} from "~/server/agents/internal/agent_limits.js";
import {AgentMessageStreamSession} from "~/server/agents/internal/agent_message_stream_session.js";
import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {
    AgentUsageWindowWithWindowLimitsAndUsedMillicents,
    getAgentUsageLimitWindows,
    isAgentUsageLimitExceeded,
    recordAgentUsage,
    shouldDowngradeModelForAgentUsageLimit,
} from "~/server/agents/internal/agent_usage_limits.js";
import {
    chatGptReadLinkTool,
    chatGptSearchAlpineTool,
    getChatGptInstructions,
} from "~/server/agents/internal/chat_gpt_instructions.js";
import {
    ChatGptAgentConversationItemCollection,
    ChatGptAgentConversationState,
    ChatGptAgentConversationStore,
} from "~/server/agents/internal/conversation/chat_gpt_agent_conversation_store.js";
import {getAgentModelDowngradedMessage} from "~/server/agents/internal/get_agent_model_downgraded_message.js";
import {getAgentTokenLimitExceededMessage} from "~/server/agents/internal/get_agent_token_limit_exceeded_message.js";
import {getAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {createAgentLinkNotFoundError} from "~/server/agents/internal/link_references/create_agent_link_not_found_error.js";
import {loadAgentLinkContent} from "~/server/agents/internal/link_references/load_agent_link_content.js";
import {printApiPathForAgentLink} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {initializeMessagesInAgentConversation} from "~/server/agents/internal/messages/initialize_messages_in_agent_conversation.js";
import {loadNewMessagesInAgentConversation} from "~/server/agents/internal/messages/load_new_messages_in_agent_conversation.js";
import {printAgentContentMarkdownTree} from "~/server/agents/internal/print_api_content_to_agent_markdown.js";
import {shouldAgentRespondToRequest} from "~/server/agents/internal/should_agent_respond_to_request.js";
import {
    SupportedAgentModels,
    agentMillicentsPerToken,
} from "~/server/agents/internal/supported_agent_models.js";
import {searchAlpineForAgent} from "~/server/agents/internal/tools/search_alpine_for_agent.js";
import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {defaultAgentErrorDisplayMessage} from "~/shared/agents/default_agent_error_text.js";
import {
    ApiMessageRoomPathObject,
    getApiMentionPathIfExists,
    isApiMessageRoomPathObject,
    parseApiBotWebhookEventIntoMessageRoomPath,
    parseApiMessageRoomPath,
    parseApiPath,
} from "~/shared/api/parse_api_path.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {
    DataLossError,
    ErrorBase,
    FailedPreconditionError,
    InvalidArgumentError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {serializeError} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type ChatGptAgentRoute = "NotFound" | "FetchConversationState" | "Webhook";

type ChatAgentGptResponse = {
    usedMillicents: number;
};

// Model configuration for ChatGPT agent.
const defaultModel: SupportedAgentModels["openai"] = "gpt-5.1";
const downgradedModel: SupportedAgentModels["openai"] = "gpt-5-mini";
const downgradeModelAtPercent = 0.75;

export class ChatGptAgentDurableObject extends AgentDurableObjectBase<ChatGptAgentRoute> {
    constructor(state: DurableObjectState, env: AgentServiceEnv) {
        super("ChatGptAgentService", state, env);
    }

    protected override _getApiKey() {
        return assertExists(
            this._env.CHAT_GPT_API_SERVICE_KEY,
            "Missing `CHAT_GPT_API_SERVICE_KEY` environment variable",
        );
    }

    protected override _parseRoute(url: URL): [string, ChatGptAgentRoute] {
        if (url.pathname === "/webhook") {
            return ["/webhook", "Webhook"];
        }

        if (url.pathname === "/conversation-state") {
            return ["/conversation-state", "FetchConversationState"];
        }

        return ["/*", "NotFound"];
    }

    protected override async _fetch(
        context: AgentContext,
        request: Request,
        route: ChatGptAgentRoute,
        span: TracerSpan,
    ): Promise<Response> {
        if (route === "FetchConversationState") {
            return this._fetchConversationState(context, request, span);
        }

        return new Response("404 Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    }

    public override async webhook(span: TracerSpan, request: AgentWebhookRequest): Promise<void> {
        // Check if the agent should respond before continuing.
        if (!(await shouldAgentRespondToRequest(span, request))) return;

        const currentTime = new Date();

        span.addData({
            agents: {
                request: {
                    provider: "openai",
                },
            },
        });

        const agentMessageStream = new AgentMessageStream({
            spaceId: request.spaceId,
            getTargetPathIfExists: async linkPath => {
                const agentLink = await getAgentLink(request.storage, linkPath);

                if (!agentLink) return null;

                return printApiPathForAgentLink(agentLink);
            },
        });

        const conversationState = await request.storage.transaction(async transaction => {
            const conversation = await ChatGptAgentConversationStore.new(transaction);
            return conversation.getState();
        });

        const agentUsageLimitWindowsPromise = span.withSpan(
            "Get agent usage limit windows",
            async span =>
                getAgentUsageLimitWindows(span, request.agentUsageDatabase.get(), {
                    accountId: request.event.authorId,
                    currentTimestamp: currentTime.getTime(),
                }),
        );

        await runAllPromises([
            agentUsageLimitWindowsPromise,
            AgentMessageStreamSession.with(
                span,
                request,
                conversationState.timeZone,
                agentMessageStream,
                async session => {
                    const {agentUsageLimitWindows, plan} = await agentUsageLimitWindowsPromise;

                    const isAgentUsageLimitExceededResult = isAgentUsageLimitExceeded(
                        span,
                        request.event.authorId,
                        agentUsageLimitWindows,
                    );

                    if (isAgentUsageLimitExceededResult.exceeded) {
                        sendLimitErrorMessage(span, request, {
                            session,
                            resetTime: new Date(isAgentUsageLimitExceededResult.resetTime),
                            currentTime,
                            shouldUpsell: shouldSendMessagingWithUpsellLink(plan),
                        });
                        return;
                    }

                    const {model, downgradedMessageData} = await getOpenAiModel(
                        span,
                        request,
                        agentUsageLimitWindows,
                    );

                    // TODO(calebmer, #ai): Implement interruption. What happens if a user sends a
                    // message while the agent is responding to a previous request?
                    const response = await requestChatGptAgent(span, request, {
                        env: this._env,
                        model,
                        session,
                        sendDowngradeWarningMessageIfNeeded: async () => {
                            // NOTE(ifitzsimmons, 2026-01-12): We only send downgraded messaging to "upsell"
                            // the user. If the user can't be upselled (they already have the max token usage),
                            // we shouldn't send the downgraded messaging. There's nothing they can do.
                            if (
                                !shouldSendMessagingWithUpsellLink(plan) ||
                                !downgradedMessageData
                            ) {
                                return;
                            }

                            sendDowngradeWarningMessage(span, request, {
                                session,
                                resetTime: downgradedMessageData.resetTime,
                                currentTime,
                            });
                        },
                    });

                    await recordAgentUsage(span, request.agentUsageDatabase.get(), {
                        accountId: request.event.authorId,
                        spaceId: request.spaceId,
                        requestUsedMillicents: response.usedMillicents,
                        currentTimestamp: currentTime.getTime(),
                        provider: "openai",
                        model,
                    });
                },
            ),
        ]);
    }

    private async _fetchConversationState(
        context: AgentContext,
        request: Request,
        span: TracerSpan,
    ): Promise<Response> {
        if (request.method !== "GET") {
            return new Response("405 Method Not Allowed", {
                status: 405,
                headers: {"content-type": "text/plain"},
            });
        }

        try {
            const url = new URL(request.url);
            const accessToken = url.searchParams.get("accessToken");
            const roomPath = url.searchParams.get("roomPath");

            if (!accessToken) throw new InvalidArgumentError("Missing `accessToken` search param");
            if (!roomPath) throw new InvalidArgumentError("Missing `roomPath` search param");

            const roomPathObject = parseApiPath(roomPath);

            if (!isApiMessageRoomPathObject(roomPathObject))
                throw new InvalidArgumentError("Invalid `roomPath` search param");

            await this._authorizeFetchConversationState(span, accessToken, roomPathObject);

            const conversationState = await ChatGptAgentConversationItemCollection.list(
                this.getStorage(),
            );

            const items = Array.from(conversationState.values(), ({item}) => item);

            // NOTE(calebmer): We don't use our `Schema` library here since we don't want
            // to open source our `Schema` code. (Though we will open source
            // `serializeError()`.)
            return new Response(JSON.stringify({ok: true, items}), {
                status: 200,
                headers: {"content-type": "application/json"},
            });
        } catch (error) {
            span.addException(error);

            return new Response(JSON.stringify({ok: false, error: serializeError(error)}), {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            });
        }
    }

    private async _authorizeFetchConversationState(
        span: TracerBase,
        accessToken: string,
        roomPathObject: ApiMessageRoomPathObject,
    ): Promise<void> {
        const apiClient = createApiClient({
            baseUrl: assertExists(
                this._env.API_SERVICE_URL,
                "Missing `API_SERVICE_URL` environment variable",
            ),
            apiKey: assertExists(
                this._env.CHAT_GPT_API_SERVICE_KEY,
                "Missing `CHAT_GPT_API_SERVICE_KEY` environment variable",
            ),
            accessToken,
        });

        const {
            data: {messages},
        } = await getApiMessagesFromStart(span, apiClient, roomPathObject, {
            limit: 1,
            cursor: null,
        });

        // Sanity check: Make sure we received at least one message from the API.
        // Verifying we have access to messages in the provided messaging room.
        if (messages.length === 0) {
            throw new FailedPreconditionError(
                "Can’t fetch conversation state for empty messaging room",
            );
        }
    }
}

/**
 * Sends a limit error message to the user when agent limits are exceeded.
 *
 * TODO: finalize messaging and format
 *   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/18hyw8ssg62c6az1a04sb82gpc
 */
function sendLimitErrorMessage(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    {
        session,
        resetTime,
        currentTime,
        shouldUpsell,
    }: {
        session: AgentMessageStreamSession;
        resetTime: Date;
        currentTime: Date;
        shouldUpsell: boolean;
    },
): void {
    session.pushText(
        getAgentTokenLimitExceededMessage(
            resetTime,
            currentTime,
            request.event.createdTimeZone,
            shouldUpsell,
        ),
    );
}

/**
 * Send a downgrade warning message to the user when they hit the premium model usage limit.
 *
 * TODO: finalize messaging and format
 *   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/18hyw8ssg62c6az1a04sb82gpc
 */
function sendDowngradeWarningMessage(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    {
        session,
        resetTime,
        currentTime,
    }: {
        session: AgentMessageStreamSession;
        resetTime: Date;
        currentTime: Date;
    },
): void {
    session.pushText(
        getAgentModelDowngradedMessage(resetTime, currentTime, request.event.createdTimeZone),
    );
}

async function requestChatGptAgent(
    span: TracerSpan,
    request: AgentWebhookRequest,
    {
        env,
        model,
        session,
        sendDowngradeWarningMessageIfNeeded,
    }: {
        env: AgentServiceEnv;
        model: SupportedAgentModels["openai"];
        session: AgentMessageStreamSession;
        sendDowngradeWarningMessageIfNeeded: () => Promise<void>;
    },
): Promise<ChatAgentGptResponse> {
    // Make sure we have the latest messages from the messaging room in
    // conversation history.
    //
    // TODO(calebmer, #ai): How should we handle the reply feature for the AI?
    await ensureMessagesInChatGptAgentConversation(span, request, session.newMessageIndex);

    // Send a message from ChatGPT.
    return createChatGptAgentMessage(span, request, {
        env,
        model,
        session,
        sendDowngradeWarningMessageIfNeeded,
    });
}

async function ensureMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    newMessageIndex: number,
): Promise<void> {
    await request.storage.transaction(async transaction => {
        const state = await ChatGptAgentConversationStore.new(transaction);

        await initializeInChatGptAgentConversationIfNeeded(tracer, transaction, request, state);

        await loadNewMessagesInAgentConversation(
            tracer,
            transaction,
            request,
            state,
            // We're going to update our conversation with the output directly from OpenAI
            // and set `lastMessageIndex` to the new message's index. Make sure if there
            // were any messages added prior to invoking the OpenAI API that we add
            // them to the conversation so they're not missed.
            newMessageIndex - 1,
        );

        // Set `lastMessageIndex` so we don't load the `ApiContent` for the agent's
        // message into the conversation history. That would be redundant given we'll
        // be adding the exact `output_item`s generated by OpenAI to our conversation
        // history.
        await state.setState(transaction, {
            lastMessageIndex: newMessageIndex,
        });
    });
}

/**
 * If the conversation hasn't been initialized, then initialize:
 *
 * 1. Developer instructions
 * 2. Message history (up to `request.event.index`)
 */
async function initializeInChatGptAgentConversationIfNeeded(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    conversation: ChatGptAgentConversationStore,
): Promise<void> {
    if (conversation.getState().lastMessageIndex !== null) return;

    // Make sure we haven't initialized any conversation items yet. If this throws,
    // maybe another process was killed during initialization?
    assert(conversation.getState().lastOrderKey === null);

    await runAllPromises([
        (async () => {
            // These both act on ChatGptAgentConversationItemCollection and the insertion
            // order matters, so they must be serialized.
            await initializeInstructionsInChatGptAgentConversation(
                tracer,
                transaction,
                request,
                conversation,
            );

            await initializeMessagesInAgentConversation({
                tracer,
                transaction,
                request,
                conversation,
            });
        })(),
        conversation.setState(transaction, {
            timeZone: request.event.createdTimeZone,
        }),
    ]);

    assert(conversation.getState().lastMessageIndex !== null);
}

async function initializeInstructionsInChatGptAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    conversation: ChatGptAgentConversationStore,
): Promise<void> {
    assert(conversation.getState().lastMessageIndex === null);

    const {
        data: {space},
    } = await request.apiClient.get(tracer, "/spaces/{id}", {
        params: {path: {id: request.spaceId}},
    });

    const instructions = getChatGptInstructions({
        spaceName: space.name,
        messageRoomType: request.room.type,
    });

    const orderKey = generateOrderKeyBetween(conversation.getState().lastOrderKey, null);

    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
        item: {
            type: "message",
            role: "developer",
            content: [{type: "input_text", text: instructions}],
        },
    });

    await conversation.setState(transaction, {
        lastOrderKey: orderKey,
    });
}

async function createChatGptAgentMessage(
    span: TracerSpan,
    request: AgentWebhookRequest,
    {
        env,
        model,
        session,
        sendDowngradeWarningMessageIfNeeded,
    }: {
        env: AgentServiceEnv;
        model: SupportedAgentModels["openai"];
        session: AgentMessageStreamSession;
        sendDowngradeWarningMessageIfNeeded: () => Promise<void>;
    },
): Promise<ChatAgentGptResponse> {
    try {
        return await createChatGptAgentResponse(span, env, request, model, session);
    } catch (error) {
        session.pushText(defaultAgentErrorDisplayMessage);

        if (error instanceof OpenAi.BadRequestError || error instanceof OpenAi.NotFoundError) {
            // NOTE(ifitzsimmons, 2025-12-04): We observed an issue [1] where a request persisted
            // some bad state (a corrupt reasoning ID) into local storage and threw a 400 error
            // (`BadRequestError`). Every subsequent request failed with a 404 (`NotFoundError`)
            // as a result until the durable object was eventually cleared (after 8 hours).
            // If the response API returns a 400 or 404 even after retrying with backoff, then we
            // should clear the durable object state so that subsequent requests will not be impacted
            // by any potentially corrupted state.
            //
            // [1]: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t6adyjshd5qaq256ks12yp395w
            await request.storage.deleteAll();
        }

        throw error;
    } finally {
        await sendDowngradeWarningMessageIfNeeded();
    }
}

function convertChatGptUsageToMillicents(
    model: SupportedAgentModels["openai"],
    usage: OpenAi.Responses.ResponseUsage,
) {
    const millicentsPerToken = agentMillicentsPerToken["openai"][model];
    const cachedInputTokens = usage.input_tokens_details.cached_tokens;
    const inputTokens = usage.input_tokens - cachedInputTokens;
    const outputTokens = usage.output_tokens;

    return (
        cachedInputTokens * millicentsPerToken.cachedInputTokens +
        inputTokens * millicentsPerToken.inputTokens +
        outputTokens * millicentsPerToken.outputTokens
    );
}

async function createChatGptAgentResponse(
    span: TracerSpan,
    env: AgentServiceEnv,
    request: AgentWebhookRequest,
    model: SupportedAgentModels["openai"],
    session: AgentMessageStreamSession,
    totalUsedMillicents = 0,
): Promise<ChatAgentGptResponse> {
    // Calls any pending functions in the conversation history. Important for our
    // ChatGPT agent loop. If an agent response has function calls then we call
    // `createChatGptAgentResponse()` again. Which starts with this function that
    // actually executes the function calls.
    const input = await getChatGptAgentConversationItemsAndCallPendingFunctions(
        span,
        request,
        session,
    );

    // TODO(calebmer, #ai): Tool calls to implement:
    //
    // - [ ] Load content underneath peek
    // - [ ] Update/create documents
    // - [ ] Update/create tasks, task collections, and subtasks
    // - [ ] View uploaded files (images mostly)
    // - [ ] Forget context tool or force compaction tool (if user feels like
    //       bot is going off the rails)
    //
    // TODO(calebmer, #ai): How do we enable the AI to mention users and other
    // content? We can include a mention database but what if they try to mention
    // something new?
    //
    // [1]: https://platform.openai.com/docs/guides/tools-web-search
    const responseStream = request.openAiClient.get().createResponseWithStreaming(span, {
        stream: true,
        model,
        // https://platform.openai.com/docs/guides/prompt-caching
        prompt_cache_key: getRoomPathForPromptCacheKey(
            request.spaceId,
            parseApiBotWebhookEventIntoMessageRoomPath(request.event),
        ),
        safety_identifier: request.event.authorId,
        // NOTE(ifitzsimmons, 2026-01-10): We had originally planned to add the web search [1] tool to
        // our agent but decided against it for several reasons:
        // 1. **Security/Privacy**: Perhaps the most compelling reason to omit web search calls.
        //    Ultimately, our users (and us admins) have no control over the information the agent may
        //    come across while searching the world wide web. Bad actors can expose this by simply
        //    injecting malicious content into a web page, for instance, and "trick" our agent into
        //    doing something dangerous. Read this article on agent security [2] for more on the
        //    topic – it's a super interesting read!
        // 2. **Cost**: The web search tool is actually quite expensive. Every 1000 calls costs $10 [3].
        //     By comparison, GPT-5.1 costs $1.25 per million output tokens. Users may not understand
        //     the comparitive cost of making web search calls (e.g. "What's the weather today?") and
        //     we don't want them to blow all of their token budget on these types of queries – they're
        //     not where our agent shines.
        // 3. **Tracking**: We didn't build a way to track Web Search tool call usage in our agent usage
        //    database. Even if we were comfortable with the cost, we'd need to calculate and include
        //    the cost of those calls in our agent usage database.
        // 4. **UX**: We weren't able to build a solid UI for web search tool calls pre-launch (no API
        //    compatibility and no UI).
        //
        // [1]: https://platform.openai.com/docs/guides/tools-web-search
        // [2]: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
        // [3]: https://platform.openai.com/docs/pricing#built-in-tools
        tools: [chatGptReadLinkTool.get(), chatGptSearchAlpineTool.get()],
        reasoning: {
            // Default reasoning effort is "medium", so we're just being explicit here.
            effort: "medium",
            summary: getReasoningSummaryForModel(model),
        },
        // Load the entire conversation history and use that as our input to OpenAI.
        input,
    });

    let hasFunctionCallOutputItem = false;

    for await (const event of responseStream) {
        switch (event.type) {
            case "response.output_item.done": {
                // TODO(calebmer, #ai): If OpenAI gives us a `reasoning` output item then we
                // should render that. So far I haven't seen any reasoning summary in the
                // output item. Can we add one?

                // If there are function calls, we'll need to execute the function calls and
                // generate a new response.
                if (event.item.type === "function_call") {
                    hasFunctionCallOutputItem = true;
                }

                // Add every output item from OpenAI to the conversation history. So when we
                // invoke OpenAI again it's previous messages, function calls, reasoning
                // tokens, etc.
                await request.storage.transaction(async transaction => {
                    const state = await ChatGptAgentConversationStore.new(transaction);

                    const orderKey = generateOrderKeyBetween(state.getState().lastOrderKey, null);

                    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
                        item: event.item,
                    });

                    await state.setState(transaction, {lastOrderKey: orderKey});
                });
                break;
            }
            case "response.output_text.delta": {
                session.pushText(event.delta);
                break;
            }
            // NOTE(ifitzsimmons, 2025-11-13): At some point, we should think about storing response
            // additions. So instead of pushing data to our database when we get the reasoning
            // summary, we should somehow store the time that the reasoning began. That way, we can
            // provide a better representation of what the agent is doing for the user. As is, the
            // current UX is pretty solid and I don't think that this is something that users will
            // even notice so I'm comfortable shipping. If we get feedback about this, we can
            // revisit. This same argument would go for tool calls as well.
            //
            // NOTE(ifitzsimmons, 2025-11-07): Opted to use this event instead of
            // `response.reasoning_summary_text.done`. They do the same exact thing.
            // https://platform.openai.com/docs/api-reference/responses-streaming/response/reasoning_summary_part/done
            // https://platform.openai.com/docs/api-reference/responses-streaming/response/reasoning_summary_text/done
            case "response.reasoning_summary_part.done": {
                session.pushReasoningSummary(event.part.text);
                break;
            }
            case "response.completed": {
                const {usage} = event.response;

                if (!usage) {
                    span.addException(
                        new DataLossError("Missing required usage in ChatGPT response"),
                    );
                }

                totalUsedMillicents += usage ? convertChatGptUsageToMillicents(model, usage) : 0;
                break;
            }
        }
    }

    // If there was a tool call, then try generating the response again! When we
    // load the conversation history, it'll include the incomplete function call.
    //
    // Keep calling recursively until there are no more function calls.
    if (hasFunctionCallOutputItem) {
        return createChatGptAgentResponse(span, env, request, model, session, totalUsedMillicents);
    }

    return {usedMillicents: totalUsedMillicents};
}

function getChatGptAgentConversationItemsAndCallPendingFunctions(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    session: AgentMessageStreamSession,
) {
    // Perform all function calls in a transaction so we only call each function
    // once. There won't be any concurrent function calling.
    return request.storage.transaction(async transaction => {
        const input = Array.from(
            (await ChatGptAgentConversationItemCollection.list(transaction)).values(),
            ({item}) => item,
        );

        const pendingFunctionCallById = new Map<string, OpenAi.Responses.ResponseFunctionToolCall>(
            [],
        );

        for (const inputItem of input) {
            if (inputItem.type === "function_call") {
                pendingFunctionCallById.set(inputItem.call_id, inputItem);
            }

            if (inputItem.type === "function_call_output") {
                pendingFunctionCallById.delete(inputItem.call_id);
            }
        }

        // No pending function calls! Return the input as is.
        if (pendingFunctionCallById.size === 0) return input;

        const state = await ChatGptAgentConversationStore.new(transaction);

        const functionCallOutputs = await runAllPromises(
            mapIterable(pendingFunctionCallById.values(), functionCall => {
                return tracer.withSpan(
                    "Call ChatGPT agent function",
                    async (
                        tracer,
                    ): Promise<OpenAi.Responses.ResponseInputItem.FunctionCallOutput> => {
                        const result = await captureResultPromise(
                            callChatGptAgentFunction({
                                tracer,
                                transaction,
                                request,
                                session,
                                functionCall,
                                conversationState: state.getState(),
                            }),
                        );

                        if (!result.ok) {
                            tracer.addException(result.error);
                        }

                        // If the call fails then we tell our LLM the error message using
                        // `displayMessage`. This is the same information a human would get.
                        let output: string;

                        if (result.ok) {
                            output = result.value;
                        } else {
                            // Log errors in development since function call error stack traces aren't shown to the user in
                            // the UI. So we show function call errors in our logs.
                            if (process.env.NODE_ENV !== "production") {
                                // eslint-disable-next-line no-console
                                console.error("Agent function call failed:", result.error);
                            }

                            const displayMessage =
                                result.error instanceof ErrorBase
                                    ? result.error.displayMessage
                                    : undefined;

                            output = `Error: \`${
                                functionCall.name
                            }\` function call failed. ${renderErrorDisplayMessageForChatGptAgent(
                                displayMessage ?? defaultErrorDisplayMessage,
                            )}`;
                        }

                        return {
                            type: "function_call_output",
                            call_id: functionCall.call_id,
                            output,
                        };
                    },
                );
            }),
        );

        const orderKeys = generateOrderKeysBetween(
            state.getState().lastOrderKey,
            null,
            functionCallOutputs.length,
        );

        // Write the result of our function calls both to storage and to the `input`
        // we'll use to generate the next response.
        for (let i = 0; i < functionCallOutputs.length; i++) {
            const orderKey = orderKeys[i]!;
            const functionCallOutput = functionCallOutputs[i]!;

            input.push(functionCallOutput);

            await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
                item: functionCallOutput,
            });
        }

        await state.setState(transaction, {lastOrderKey: orderKeys[orderKeys.length - 1]!});

        return input;
    });
}

function renderErrorDisplayMessageForChatGptAgent(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
                string += segment.text;
                break;

            case "SensitiveText":
                string += segment.text;
                break;

            // We don't include URLs in API error messages. Since an error message won't be
            // rendered in an interactive context.
            case "Link":
                string += segment.text;
                break;

            default:
                throw exhaustive(segment);
        }
    }

    return string;
}

async function callChatGptAgentFunction({
    tracer,
    transaction,
    request,
    session,
    functionCall,
    conversationState,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    session: AgentMessageStreamSession;
    functionCall: OpenAi.Responses.ResponseFunctionToolCall;
    conversationState: ChatGptAgentConversationState;
}): Promise<string> {
    let functionCallArguments: unknown;
    try {
        functionCallArguments = JSON.parse(functionCall.arguments);
    } catch {
        throw new InvalidArgumentError("Invalid function call arguments", {
            displayMessage: errorDisplayMessage`The function call’s arguments aren’t valid JSON.`,
        });
    }

    switch (functionCall.name) {
        case "read_link": {
            checkChatGptFunctionCallOutputTokenCount(session);

            if (
                !isObject(functionCallArguments) ||
                typeof functionCallArguments.path !== "string"
            ) {
                throw new InvalidArgumentError("Missing `path` string in function call arguments", {
                    displayMessage: errorDisplayMessage`The function call’s arguments must be an object with the \`path\` string.`,
                });
            }

            const {path} = functionCallArguments;

            const link = await getAgentLink(transaction, path);

            // If we can't find the link reference for the provided label, then throw a
            // nice error for ChatGPT so it can retry.
            if (!link) {
                throw createAgentLinkNotFoundError(path);
            }

            const targetApiPath = printApiPathForAgentLink(link);
            const mentionApiPath = getApiMentionPathIfExists(targetApiPath);

            // TODO(ifitzsimmons, #ai): Change the read tool call interface such that
            // we pass in the SearchEntityId. Then we can load the content for that entity
            // when streaming the messages back to the client.
            // As it stands right now, we won't stream Chat, ChatMessage, And ChatMessages
            // reads back to the client at all.
            if (mentionApiPath) {
                session.pushToolCall({
                    type: "Read",
                    target: {path: mentionApiPath},
                });
            }

            // Use the class's loadContent method - all logic is encapsulated!
            const markdownTree = await loadAgentLinkContent({
                tracer,
                transaction,
                request,
                link,
                conversationState,
            });

            const output = printAgentContentMarkdownTree(markdownTree);
            session.updateFunctionCallOutputTokenCount(output);
            return output;
        }
        case "search_alpine": {
            checkChatGptFunctionCallOutputTokenCount(session);

            if (
                !isObject(functionCallArguments) ||
                typeof functionCallArguments.query !== "string"
            ) {
                throw new InvalidArgumentError(
                    "Invalid `query` string in function call arguments",
                    {
                        displayMessage: errorDisplayMessage`The function call’s arguments must be an object with a \`query\` string.`,
                    },
                );
            }

            session.pushToolCall({
                type: "Search",
                query: functionCallArguments.query,
            });

            const output = await searchAlpineForAgent(
                tracer,
                transaction,
                request,
                functionCallArguments.query,
            );
            session.updateFunctionCallOutputTokenCount(output);
            return output;
        }
        default: {
            throw new InvalidArgumentError("Unrecognized function name", {
                displayMessage: errorDisplayMessage`\`${functionCall.name}\` isn’t a function name we recognize.`,
            });
        }
    }
}

function checkChatGptFunctionCallOutputTokenCount(session: AgentMessageStreamSession) {
    if (session.functionCallOutputTokenCount > agentMaxTokenCountPerWebhookCall) {
        throw new FailedPreconditionError("Function call output token limit exceeded", {
            displayMessage: errorDisplayMessage`Read limit reached. You (ChatGPT) can’t call the \`read_link\` or \`search_alpine\` tools until the user sends another message. Use the information you have to respond to the user. At the end of your response, if there’s more work you’d like to do then let the user know without mentioning read limits. For example: “I might not have found everything you’re looking for, would you like me to search for XYZ?”`,
        });
    }
}

// NOTE(ifitzsimmons, 2025-11-14): The maximum length of a prompt_cache_key is 64 characters. Our
// IDs are 26 characters long, so we can't fit more than two IDs in a prompt_cache_key.
// Document comment threads are uniquely identified by their DocumentId x ThreadId combination,
// so we can drop the Space ID.
function getRoomPathForPromptCacheKey(spaceId: SpaceId, roomPath: ApiMessageRoomPath): string {
    const roomPathObject = parseApiMessageRoomPath(roomPath);

    switch (roomPathObject.type) {
        case "Chat":
        case "Post":
        case "Task":
            return `${spaceId}:${roomPath}`;
        case "DocumentCommentThread":
            // "thread/" (7 characters) + ID * 2 (52 characters + "-" (1 character)) = 60 characters
            return `thread/${roomPathObject.id}-${roomPathObject.threadId}`;
        default:
            throw exhaustive(roomPathObject);
    }
}

/**
 * It's cost-efficient to use concise reasoning summaries for the GPT agent. However, not
 * all models support concise reasoning summaries.
 *
 * When adding or changing supported OpenAI models, make sure to test that the model
 * supports concise summaries. If it doesn't we should discuss the tradeoffs of using
 * the model as a team. Longer reasoning summaries ultimately limit the number of requests
 * users can make to our agents. We're betting that users prefer more agent usage over
 * more descriptive reasoning summaries.
 */
function getReasoningSummaryForModel(model: SupportedAgentModels["openai"]): "concise" {
    switch (model) {
        case "gpt-5.1":
        case "gpt-5-mini":
            return "concise";
        default:
            throw exhaustive(model);
    }
}

async function getOpenAiModel(
    span: TracerSpan,
    request: AgentWebhookRequest,
    agentUsageLimitWindows: Array<AgentUsageWindowWithWindowLimitsAndUsedMillicents>,
): Promise<{
    model: SupportedAgentModels["openai"];
    downgradedMessageData: {resetTime: Date} | null;
}> {
    const shouldDowngradeModelResult = await shouldDowngradeModelForAgentUsageLimit(
        span,
        request.agentUsageDatabase.get(),
        agentUsageLimitWindows,
        downgradeModelAtPercent,
    );

    // Use downgraded model if indicated by usage limits
    const model: SupportedAgentModels["openai"] = shouldDowngradeModelResult.shouldDowngrade
        ? downgradedModel
        : defaultModel;

    span.addData({
        agents: {
            request: {
                model,
            },
        },
    });

    const shouldSendDowngradedMessage =
        shouldDowngradeModelResult.shouldDowngrade && shouldDowngradeModelResult.shouldAlertUser;

    return {
        model,
        downgradedMessageData: shouldSendDowngradedMessage
            ? {
                  resetTime: shouldDowngradeModelResult.resetTime,
              }
            : null,
    };
}

function shouldSendMessagingWithUpsellLink(plan: "Free" | "LifetimeAccess"): boolean {
    switch (plan) {
        case "Free":
            return true;
        case "LifetimeAccess":
            return false;
        default:
            throw exhaustive(plan);
    }
}
