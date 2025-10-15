import OpenAi from "openai";
import {stringify as stringifyYaml} from "yaml";
import {
    AgentDurableObjectBase,
    AgentDurableObjectEnv,
    AgentWebhookRequest,
} from "~/server/agents/internal/agent_durable_object_base.js";
import {
    completeApiMessageStream,
    createApiMessage,
    putApiMessageStreamPart,
} from "~/server/agents/internal/api_client.js";
import {
    chatGptReadLinkTool,
    getChatGptInstructions,
} from "~/server/agents/internal/chat_gpt_instructions.js";
import {
    ChatGptAgentConversationItemCollection,
    ChatGptAgentConversationStateStore,
} from "~/server/agents/internal/conversation_state/chat_gpt_agent_conversation_state.js";
import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {initializeMessagesInAgentConversation} from "~/server/agents/internal/messages/initialize_messages_in_agent_conversation.js";
import {loadNewMessagesInAgentConversation} from "~/server/agents/internal/messages/load_new_messages_in_agent_conversation.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";
import {
    AgentConversationLink,
    getAgentContentLinkReference,
    printAgentContentToMarkdownTree,
    putAgentContentLinkReference,
} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {shouldAgentRespondToRequest} from "~/server/agents/internal/should_agent_respond_to_request.js";
import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {parseApiContentMentionInlineElementTargetPath} from "~/shared/api/parse_api_path.js";
import {
    ApiContent,
    ApiContentMentionInlineElementTargetPath,
    ApiMessage,
    ApiMessageStreamPartPayload,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type ChatGptAgentRoute = "NotFound";

export class ChatGptAgentDurableObject extends AgentDurableObjectBase<ChatGptAgentRoute> {
    constructor(state: DurableObjectState, env: AgentDurableObjectEnv) {
        super("ChatGptAgentService", state, env);
    }

    protected override _parseRoute(url: URL): [string, ChatGptAgentRoute | "Webhook"] {
        if (url.pathname === "/webhook") {
            return ["/webhook", "Webhook"];
        }

        return ["/*", "NotFound"];
    }

    protected override async _fetch(): Promise<Response> {
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
}

async function insertAgentMessagesIntoChatGptAgentConversationItemCollection(
    transaction: DurableObjectTransaction,
    orderKey: OrderKey,
    messages: Array<AgentMessage>,
) {
    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
        item: {
            type: "message",
            role: "user",
            content: [{type: "input_text", text: printAgentMessagesLog(messages).trimEnd()}],
        },
    });
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
    await ensureMessagesInChatGptAgentConversation(tracer, request);

    // Send a message from ChatGPT.
    await createChatGptAgentMessage(tracer, request);
}

async function ensureMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    await request.storage.transaction(async transaction => {
        const state = await ChatGptAgentConversationStateStore.new(transaction);

        await initializeInChatGptAgentConversationIfNeeded(tracer, transaction, request, state);

        await loadNewMessagesInAgentConversation(
            tracer,
            transaction,
            request,
            state,
            insertAgentMessagesIntoChatGptAgentConversationItemCollection,
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
    state: ChatGptAgentConversationStateStore,
): Promise<void> {
    if (state.get().lastMessageIndex !== null) return;

    // Make sure we haven't initialized any conversation items yet. If this throws,
    // maybe another process was killed during initialization?
    assert(state.get().lastOrderKey === null);

    await initializeInstructionsInChatGptAgentConversation(tracer, transaction, request, state);

    await initializeMessagesInAgentConversation(
        tracer,
        transaction,
        request,
        state,
        insertAgentMessagesIntoChatGptAgentConversationItemCollection,
    );

    assert(state.get().lastMessageIndex !== null);
}

async function initializeInstructionsInChatGptAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    state: ChatGptAgentConversationStateStore,
): Promise<void> {
    assert(state.get().lastMessageIndex === null);

    const {
        data: {space},
    } = await request.apiClient.GET(tracer, "/spaces/{id}", {
        params: {path: {id: request.spaceId}},
    });

    const instructions = getChatGptInstructions({
        spaceName: space.name,
        messageRoomType: request.room.type,
    });

    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
        item: {
            type: "message",
            role: "developer",
            content: [{type: "input_text", text: instructions}],
        },
    });

    await state.set(transaction, {
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
        getMentionTargetPathIfExists: async label => {
            const reference = await getAgentContentLinkReference(request.storage, label);
            return reference?.mentionTargetPath ?? null;
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
): Promise<ApiMessage> {
    return request.storage.transaction(async transaction => {
        const state = await ChatGptAgentConversationStateStore.new(transaction);

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
        });

        // We're going to update our conversation with the output directly from OpenAI
        // and set `lastMessageIndex` to the new message's index. Make sure if there
        // were any messages added while we were generating our response that we add
        // them to the conversation so they're not missed.
        await loadNewMessagesInAgentConversation(
            tracer,
            transaction,
            request,
            state,
            insertAgentMessagesIntoChatGptAgentConversationItemCollection,
            message.index - 1,
        );

        // Set `lastMessageIndex` so we don't load the `ApiContent` for the agent's
        // message into the conversation history. That would be redundant given we'll
        // be adding the exact `output_item`s generated by OpenAI to our conversation
        // history.
        await state.set(transaction, {
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
                    const state = await ChatGptAgentConversationStateStore.new(transaction);

                    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

                    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
                        item: event.item,
                    });

                    await state.set(transaction, {lastOrderKey: orderKey});
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

        const state = await ChatGptAgentConversationStateStore.new(transaction);

        const functionCallOutputs = await runAllPromises(
            mapIterable(pendingFunctionCallById.values(), functionCall => {
                return tracer.withSpan(
                    "Call ChatGPT agent function",
                    async (
                        tracer,
                    ): Promise<OpenAi.Responses.ResponseInputItem.FunctionCallOutput> => {
                        const result = await captureResultPromise(
                            callChatGptAgentFunction(
                                tracer,
                                transaction,
                                request,
                                messageState,
                                functionCall,
                            ),
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
            state.get().lastOrderKey,
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

        await state.set(transaction, {lastOrderKey: orderKeys[orderKeys.length - 1]!});

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

async function callChatGptAgentFunction(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    messageState: ChatGptAgentMessageState,
    functionCall: OpenAi.Responses.ResponseFunctionToolCall,
): Promise<string> {
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
                typeof functionCallArguments.label !== "string"
            ) {
                throw new InvalidArgumentError(
                    "Missing `label` string in function call arguments",
                    {
                        displayMessage: errorDisplayMessage`The function call’s arguments must be an object with the \`label\` string.`,
                    },
                );
            }

            const {label} = functionCallArguments;

            const linkReference = await getAgentContentLinkReference(transaction, label);

            // If we can't find the link reference for the provided label, then throw a
            // nice error for ChatGPT so it can retry.
            if (!linkReference) {
                throw new NotFoundError("Link reference not found", {
                    displayMessage: errorDisplayMessage`Couldn’t find a link with label “${label}”. Make sure the label exactly matches the link’s text within square brackets. So if you have a link whose Markdown looks like this: “[My Document][]”, then the correct label would be “My Document”.`,
                });
            }

            messageState.pushToolCall({
                type: "Read",
                targetPath: linkReference.mentionTargetPath,
                title: linkReference.originalLabel,
            });

            return readMentionContentForChatGptAgent(
                tracer,
                transaction,
                request,
                linkReference.mentionTargetPath,
            );
        }
        default: {
            throw new InvalidArgumentError("Unrecognized function name", {
                displayMessage: errorDisplayMessage`\`${functionCall.name}\` isn’t a function name we recognize.`,
            });
        }
    }
}

async function readMentionContentForChatGptAgent(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    entityPath: ApiContentMentionInlineElementTargetPath,
): Promise<string> {
    const {frontmatter, content} = await actuallyReadMentionContentForChatGptAgent(
        tracer,
        transaction,
        request,
        entityPath,
    );

    const markdownTree = await printAgentContentToMarkdownTree(
        transaction,
        content ?? {elements: []},
        {spaceId: request.spaceId},
    );

    markdownTree.children.unshift({
        type: "yaml",
        value: stringifyYaml(
            mapObjectValues(frontmatter, value => {
                // Use our Markdown mention syntax for links so the LLM can figure out it can
                // read this content with a `read_link` tool call.
                if (isObject(value)) return `[${value.getEscapedLabel()}][]`;

                return value;
            }),
        ).trim(),
    });

    return printMarkdownTree(markdownTree);
}

/**
 * We format the content for the LLM as Markdown with YAML frontmatter. The
 * YAML frontmatter always includes the entity `type`. Then some metadata we
 * think is relevant for the LLM. Any links are formatted with our
 * `[link text][]` format so hopefully the LLM can figure out it needs to use
 * `read_link` to load the content.
 */
async function actuallyReadMentionContentForChatGptAgent(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    entityPath: ApiContentMentionInlineElementTargetPath,
): Promise<{
    frontmatter: {type: string} & Record<
        string,
        string | boolean | AgentConversationLink | undefined
    >;
    // TODO(calebmer, #ai): For long content we shouldn't put the entire thing in
    // context. We should only put the first few tokens in context then give
    // ChatGPT a tool to read more. Right now the longest document should consume
    // <25% of GPT-5's context window (based on some estimations using DynamoDB's
    // max item size).
    content?: ApiContent;
}> {
    const entity = parseApiContentMentionInlineElementTargetPath(entityPath);

    switch (entity.type) {
        case "Account": {
            const {
                data: {account},
            } = await request.apiClient.GET(tracer, "/spaces/{id}/accounts/{accountId}", {
                params: {path: {id: request.spaceId, accountId: entity.accountId}},
            });

            return {
                frontmatter: {
                    type: "Account",
                    name: account.name,
                    isBot: account.botId ? true : undefined,
                    wasRemoved: account.space.inactive?.type === "Removed" ? true : undefined,
                },
            };
        }
        case "Document": {
            const {
                data: {document},
            } = await request.apiClient.GET(tracer, "/documents/{id}", {
                params: {path: {id: entity.documentId}},
            });

            return {
                frontmatter: {
                    type: "Document",
                    title: document.title,
                },
                content: document.content,
            };
        }
        case "Post": {
            const {
                data: {post},
            } = await request.apiClient.GET(tracer, "/posts/{id}", {
                params: {path: {id: entity.postId}},
            });

            const authorLink = await putAgentContentLinkReference(
                transaction,
                post.author.name,
                `/accounts/${post.author.id}`,
            );

            const channelLink = post.channel
                ? await putAgentContentLinkReference(
                      transaction,
                      post.channel.name,
                      `/channels/${post.channel.id}`,
                  )
                : undefined;

            return {
                frontmatter: {
                    type: "Post",
                    author: authorLink,
                    channel: channelLink,
                },
                content: post.content,
            };
        }
        case "Channel": {
            const {
                data: {channel},
            } = await request.apiClient.GET(tracer, "/channels/{id}", {
                params: {path: {id: entity.channelId}},
            });

            return {
                frontmatter: {
                    type: "Channel",
                    name: channel.name,
                },
                content: channel.description,
            };
        }
        case "Task": {
            const {
                data: {task},
            } = await request.apiClient.GET(tracer, "/tasks/{id}", {
                params: {path: {id: entity.taskId}},
            });

            const assigneeLink = task.assignee
                ? await putAgentContentLinkReference(
                      transaction,
                      task.assignee.name,
                      `/accounts/${task.assignee.id}`,
                  )
                : undefined;

            // TODO(calebmer, #ai): We should include the first few child tasks in
            // and give ChatGPT a tool to read more.
            return {
                frontmatter: {
                    type: "Task",
                    status: task.status.type,
                    isActive: task.status.type === "Open" ? task.status.isActive : undefined,
                    title: task.title,
                    assignee: assigneeLink,
                    dueDate: task.due?.date,
                    priority: task.priority,
                },
                content: task.content,
            };
        }
        case "TaskCollection": {
            const {
                data: {taskCollection},
            } = await request.apiClient.GET(tracer, "/task-collections/{id}", {
                params: {path: {id: entity.collectionId}},
            });

            // TODO(calebmer, #ai): We should include the first few tasks in
            // the task collection and give ChatGPT a tool to read more.
            return {
                frontmatter: {
                    type: "TaskCollection",
                    name: taskCollection.name,
                },
            };
        }
        default:
            throw exhaustive(entity);
    }
}
