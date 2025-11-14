import OpenAi from "openai";
import {
    completeApiMessageStream,
    createApiClient,
    createApiMessage,
    getApiMessagesFromStart,
    putApiMessageStreamPart,
} from "~/server/agents/api/api_client.js";
import {
    AgentContext,
    AgentDurableObjectBase,
    AgentDurableObjectEnv,
    AgentWebhookRequest,
} from "~/server/agents/internal/agent_durable_object_base.js";
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
import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {getAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {createAgentLinkNotFoundError} from "~/server/agents/internal/link_references/create_agent_link_not_found_error.js";
import {loadAgentLinkContent} from "~/server/agents/internal/link_references/load_agent_link_content.js";
import {
    printAgentPlainTextLabel,
    printApiPathForAgentLink,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {initializeMessagesInAgentConversation} from "~/server/agents/internal/messages/initialize_messages_in_agent_conversation.js";
import {loadNewMessagesInAgentConversation} from "~/server/agents/internal/messages/load_new_messages_in_agent_conversation.js";
import {shouldAgentRespondToRequest} from "~/server/agents/internal/should_agent_respond_to_request.js";
import {searchAlpineForAgent} from "~/server/agents/internal/tools/search_alpine_for_agent.js";
import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiMessageRoomPathObject,
    getApiMentionPathIfExists,
    isApiMessageRoomPathObject,
    parseApiPath,
} from "~/shared/api/parse_api_path.js";
import {
    ApiMessageResponse,
    ApiMessageStreamPartPayload,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase, FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {serializeError} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
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
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type ChatGptAgentRoute = "NotFound" | "FetchConversationState";

export class ChatGptAgentDurableObject extends AgentDurableObjectBase<ChatGptAgentRoute> {
    constructor(state: DurableObjectState, env: AgentDurableObjectEnv) {
        super("ChatGptAgentService", state, env);
    }

    protected override _parseRoute(url: URL): [string, ChatGptAgentRoute | "Webhook"] {
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

    protected override async _webhook(tracer: TracerBase, request: AgentWebhookRequest) {
        // TODO(calebmer, #ai): Implement interruption. What happens if a user sends a
        // message while the agent is responding to a previous request?
        await requestChatGptAgent(tracer, request);
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

async function requestChatGptAgent(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    // Check if the agent should respond before continuing.
    if (!(await shouldAgentRespondToRequest(tracer, request))) return;

    // Make sure we have the latest messages from the messaging room in
    // conversation history.
    //
    // TODO(calebmer, #ai): How should we handle the reply feature for the AI?
    //
    // TODO(ifitzsimmons, #ai): Don't load all messages at once. Use pagination to
    // load conversation history instead.
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/w11jwcrp2asdf79nre611p48fr
    await ensureMessagesInChatGptAgentConversation(tracer, request);

    // Send a message from ChatGPT.
    await createChatGptAgentMessage(tracer, request);
}

async function ensureMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    await request.storage.transaction(async transaction => {
        const state = await ChatGptAgentConversationStore.new(transaction);

        await initializeInChatGptAgentConversationIfNeeded(tracer, transaction, request, state);

        await loadNewMessagesInAgentConversation(
            tracer,
            transaction,
            request,
            state,
            request.event.index,
        );
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

    await initializeInstructionsInChatGptAgentConversation(
        tracer,
        transaction,
        request,
        conversation,
    );

    await initializeMessagesInAgentConversation(tracer, transaction, request, conversation);

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

type ChatGptAgentMessageState = {
    pushText(text: string): void;
    pushToolCall(call: ApiMessageStreamToolCallPartPayloadCall): void;
};

async function createChatGptAgentMessage(tracer: TracerBase, request: AgentWebhookRequest) {
    const {index: messageIndex} = await createChatGptAgentEmptyStreamMessage(tracer, request);

    const content = new AgentMessageStream({
        spaceId: request.spaceId,
        getTargetPathIfExists: async linkPath => {
            const agentLink = await getAgentLink(request.storage, linkPath);

            if (!agentLink) return null;

            return printApiPathForAgentLink(agentLink);
        },
    });

    const updateThrottleMs = 100;
    let updateTimeout: Timeout | null = null;
    const updateMutex = new Mutex();

    const update = (
        newPartPayloads?: Array<Exclude<ApiMessageStreamPartPayload, {type: "Content"}>>,
    ) => {
        void updateMutex.withLock(async () => {
            await tracer.withSpan("Update message stream", async tracer => {
                const putParts = await content.update(newPartPayloads);

                // TODO(calebmer): We should consider adding a batch `PUT` API. That would be
                // more efficient than making two separate `PUT` requests when `update()`
                // returns multiple parts.
                for (let part of putParts) {
                    if (part.payload.type === "Content") {
                        let content = part.payload.content;

                        // Convert all straight quotes (`'` and `"`) into proper curly quotes
                        // (`“`, `”`, `‘`, `’`). Since LLMs typically only output straight quotes.
                        // Curly quotes are proper typography and are consistent with text written in
                        // Alpine where we automatically convert quotes into curly quotes.
                        content = convertApiContentToProperQuotes(part.payload.content);

                        if (content !== part.payload.content) {
                            part = {...part, payload: {...part.payload, content}};
                        }
                    }

                    await putApiMessageStreamPart(
                        tracer,
                        request.apiClient,
                        request.room,
                        messageIndex,
                        part.index,
                        {payload: part.payload},
                    );
                }
            });
        });
    };

    const messageState: ChatGptAgentMessageState = {
        pushText: text => {
            content.pushText(text);

            // We throttle updates to once every 100ms instead of once every token
            // OpenAI sends us.
            if (updateTimeout === null) {
                updateTimeout = createTimeout(() => {
                    updateTimeout = null;
                    update();
                }, updateThrottleMs);
            }
        },
        pushToolCall: call => {
            updateTimeout?.clear();
            updateTimeout = null;
            update([{type: "ToolCall", call}]);
        },
    };

    try {
        await createChatGptAgentResponse(tracer, request, messageState);
    } catch (error) {
        content.pushText(
            "I couldn’t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at [support@alpine.inc](mailto:support@alpine.inc)",
        );
        throw error;
    } finally {
        // @ts-expect-error: TypeScript is dumb and doesn't realize
        // `createChatGptAgentResponse()` may call `messageState.pushText()` and set
        // `updateTimeout`.
        updateTimeout?.clear();
        updateTimeout = null;
        update();

        await updateMutex.waitForUnlock();

        await completeApiMessageStream(tracer, request.apiClient, request.room, messageIndex);
    }
}

function createChatGptAgentEmptyStreamMessage(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<ApiMessageResponse> {
    return request.storage.transaction(async transaction => {
        const conversation = await ChatGptAgentConversationStore.new(transaction);

        // TODO(calebmer, #ai): When you're talking to AI in a messaging room we
        // probably shouldn't update an inbox entry if you're viewing the AI's
        // response. What's the right heuristic here?
        //
        // This is also kind of a problem when you're chatting with someone in general.
        // The entry keeps getting added/removed from the inbox as you interact.
        // Ideally we should "suppress" notification events for some amount of time
        // right after you respond.
        const {
            data: {message},
        } = await createApiMessage(tracer, request.apiClient, request.room, {
            isStream: true,
            content: {elements: []},
            createdTimeZone: conversation.getState().timeZone,
        });

        // We're going to update our conversation with the output directly from OpenAI
        // and set `lastMessageIndex` to the new message's index. Make sure if there
        // were any messages added while we were generating our response that we add
        // them to the conversation so they're not missed.
        await loadNewMessagesInAgentConversation(
            tracer,
            transaction,
            request,
            conversation,
            message.index - 1,
        );

        // Set `lastMessageIndex` so we don't load the `ApiContent` for the agent's
        // message into the conversation history. That would be redundant given we'll
        // be adding the exact `output_item`s generated by OpenAI to our conversation
        // history.
        await conversation.setState(transaction, {
            lastMessageIndex: message.index,
        });

        return message;
    });
}

async function createChatGptAgentResponse(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    messageState: ChatGptAgentMessageState,
): Promise<void> {
    // Calls any pending functions in the conversation history. Important for our
    // ChatGPT agent loop. If an agent response has function calls then we call
    // `createChatGptAgentResponse()` again. Which starts with this function that
    // actually executes the function calls.
    const input = await getChatGptAgentConversationItemsAndCallPendingFunctions(
        tracer,
        request,
        messageState,
    );

    // TODO(calebmer, #ai): Tool calls to implement:
    //
    // - [ ] Upgrade to reasoning model
    // - [ ] Load mentioned content
    // - [ ] Load previous chat messages
    // - [ ] Load content underneath peek
    // - [ ] Alpine search
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
    const responseStream = request.openAiClient.get().createResponseWithStreaming(tracer, {
        stream: true,

        // TODO(ifitzsimmons, #ai): Manage models with config (environment variables?)
        model: "gpt-5",
        // https://platform.openai.com/docs/guides/prompt-caching
        prompt_cache_key: `${request.spaceId}:${request.event.roomPath}`,
        safety_identifier: request.event.authorId,
        tools: [
            chatGptReadLinkTool.get(),
            chatGptSearchAlpineTool.get(),
            // https://platform.openai.com/docs/guides/tools-web-search
            {type: "web_search"},
        ],

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
                messageState.pushText(event.delta);
                break;
            }
        }
    }

    // If there was a tool call, then try generating the response again! When we
    // load the conversation history, it'll include the incomplete function call.
    //
    // Keep calling recursively until there are no more function calls.
    if (hasFunctionCallOutputItem) {
        await createChatGptAgentResponse(tracer, request, messageState);
    }
}

function getChatGptAgentConversationItemsAndCallPendingFunctions(
    tracer: TracerBase,
    request: AgentWebhookRequest,
    messageState: ChatGptAgentMessageState,
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
                                messageState,
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
    messageState,
    functionCall,
    conversationState,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: AgentWebhookRequest;
    messageState: ChatGptAgentMessageState;
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
                messageState.pushToolCall({
                    type: "Read",
                    target: {path: mentionApiPath},
                    title: printAgentPlainTextLabel(link),
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
            return printMarkdownTree(markdownTree);
        }
        case "search_alpine": {
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

            messageState.pushToolCall({
                type: "Search",
                query: functionCallArguments.query,
            });

            return searchAlpineForAgent(tracer, transaction, request, functionCallArguments.query);
        }
        default: {
            throw new InvalidArgumentError("Unrecognized function name", {
                displayMessage: errorDisplayMessage`\`${functionCall.name}\` isn’t a function name we recognize.`,
            });
        }
    }
}
