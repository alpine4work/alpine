import OpenAi from "openai";
import {
    AgentDurableObjectBase,
    AgentDurableObjectEnv,
    AgentWebhookRequest,
} from "~/server/agents/internal/agent_durable_object_base.js";
import {
    ApiClient,
    createApiMessage,
    getApiMessagesFromEnd,
    getApiMessagesFromStart,
} from "~/server/agents/internal/api_client.js";
import {getChatGptInstructions} from "~/server/agents/internal/chat_gpt_instructions.js";
import {convertApiContentToProperQuotes} from "~/server/agents/internal/convert_api_content_to_proper_quotes.js";
import {DurableObjectStorageCollection} from "~/server/agents/internal/durable_object_storage.js";
import {
    AgentMessage,
    printAgentMessagesLog,
} from "~/server/agents/internal/print_agent_messages_log.js";
import {
    parseApiContentFromMarkdownTree,
    parseMarkdownTree,
} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {ApiMessageRoomPathObject} from "~/server/api/specification/parse_api_path.js";
import {ApiChat} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
} from "~/shared/helpers/sort/order_key.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * How many messages to load from the API at once.
 */
const apiMessagesLimit = 30;

/**
 * The initial token limit for messages to include in context. This is based on
 * 750 words which is about the average length of a Wikipedia article. Then we
 * use the [rule of thumb that 1 token is 3/4 of a word][1] so a Wikipedia
 * article's worth of context is about 1000 tokens. Then we multiply by 1.5 since
 * 1000 felt like too little context from basic local testing.
 *
 * [1]: https://platform.openai.com/tokenizer
 */
const agentContextManagerInitializeLimitTokenCount = 1500;

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

const ApiChatCollection = new DurableObjectStorageCollection<ChatId, ApiChat>("a0");

type ChatGptAgentConversationState = {
    readonly lastOrderKey: OrderKey | null;
    readonly lastMessageIndex: number | null;
};

const ChatGptAgentConversationStateCollection = new DurableObjectStorageCollection<
    "",
    ChatGptAgentConversationState
>("a1");

type ChatGptAgentConversationItem = {
    readonly item: OpenAi.Responses.ResponseInputItem;
};

const ChatGptAgentConversationItemCollection = new DurableObjectStorageCollection<
    OrderKey,
    ChatGptAgentConversationItem
>("a2");

class ChatGptAgentConversationStateStore {
    private _state: ChatGptAgentConversationState;

    private constructor(state: ChatGptAgentConversationState) {
        this._state = state;
    }

    public static async new(transaction: DurableObjectTransaction) {
        const state = (await ChatGptAgentConversationStateCollection.get(transaction, "")) ?? {
            lastMessageIndex: null,
            lastOrderKey: null,
        };

        return new ChatGptAgentConversationStateStore(state);
    }

    public get() {
        return this._state;
    }

    public async set(
        transaction: DurableObjectTransaction,
        stateUpdate: Partial<ChatGptAgentConversationState>,
    ) {
        this._state = {
            ...this._state,
            ...stateUpdate,
        };

        await ChatGptAgentConversationStateCollection.put(transaction, "", this._state);
    }
}

async function requestChatGptAgent(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    // Check if the agent should respond before continuing.
    if (!(await shouldChatGptAgentRespond(tracer, request))) return;

    // Make sure we have the latest messages from the messaging room in
    // conversation history.
    //
    // TODO(calebmer, #ai): How should we handle the reply feature for the AI?
    await ensureMessagesInChatGptAgentConversation(tracer, request);

    // Send a response as ChatGPT!
    await createChatGptAgentResponse(tracer, request);
}

async function shouldChatGptAgentRespond(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<boolean> {
    // Always respond if mentioned.
    if (request.event.wasMentioned) return true;

    // If this isn't a chat, the agent only responds if mentioned.
    if (request.room.type !== "Chat") return false;

    const {chatId} = request.room;

    const chat = await ApiChatCollection.getOrPutDefault(request.storage, chatId, async () => {
        const {
            data: {chat},
        } = await request.apiClient.GET(tracer, "/chats/{id}", {
            params: {path: {id: chatId}},
        });
        return chat;
    });

    // If this is a 1:1 chat between the agent and another user, then the agent
    // will always respond.
    return (
        chat.members.length === 2 &&
        chat.members.some(member => member.account.id === request.accountId)
    );
}

async function ensureMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    await request.storage.transaction(async transaction => {
        const state = await ChatGptAgentConversationStateStore.new(transaction);

        await initializeInChatGptAgentConversationIfNeeded(tracer, transaction, request, state);

        await loadNewMessagesInChatGptAgentConversation(
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
    state: ChatGptAgentConversationStateStore,
): Promise<void> {
    if (state.get().lastMessageIndex !== null) return;

    // Make sure we haven't initialized any conversation items yet. If this throws,
    // maybe another process was killed during initialization?
    assert(state.get().lastOrderKey === null);

    await initializeInstructionsInChatGptAgentConversation(tracer, transaction, request, state);

    await initializeMessagesInChatGptAgentConversation(tracer, transaction, request, state);

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
            role: "developer",
            content: instructions,
        },
    });

    await state.set(transaction, {
        lastOrderKey: orderKey,
    });
}

async function initializeMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    state: ChatGptAgentConversationStateStore,
): Promise<void> {
    assert(state.get().lastMessageIndex === null);

    const messages = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        request.room,
        {
            startingIndex: request.event.index,
            limitTokenCount: agentContextManagerInitializeLimitTokenCount,
        },
    );

    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
        item: {
            role: "user",
            content: printAgentMessagesLog(messages).trimEnd(),
        },
    });

    await state.set(transaction, {
        lastOrderKey: orderKey,
        lastMessageIndex: request.event.index,
    });
}

async function getAgentMessagesFromEndUntilLimitTokenCount(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    apiClient: ApiClient,
    spaceId: SpaceId,
    roomPathObject: ApiMessageRoomPathObject,
    {startingIndex, limitTokenCount}: {startingIndex: number; limitTokenCount: number},
): Promise<Array<AgentMessage>> {
    let cursor: number | null = startingIndex + 1;
    let totalTokenCount = 0;
    const messages: Array<AgentMessage> = [];

    // Load messages until we reach our token limit.
    while (cursor !== null && totalTokenCount < limitTokenCount) {
        const {
            data: {nextCursor, messages: currentMessages},
        } = await getApiMessagesFromEnd(tracer, apiClient, roomPathObject, {
            limit: apiMessagesLimit,
            cursor,
        });

        cursor = nextCursor;

        for (let i = currentMessages.length - 1; i >= 0; i--) {
            const currentMessage = currentMessages[i]!;
            if (currentMessage.payload.type === "Deleted") continue;

            const message = await AgentMessage.new(transaction, {
                spaceId,
                index: currentMessage.index,
                author: currentMessage.author,
                createdTime: currentMessage.createdTime,
                payload: currentMessage.payload,
            });

            const tokenCount = message.getTokenCount();

            // If this message would put us over our token limit then DO NOT add the
            // message and instead return the messages we have.
            //
            // Unless we've filled less than half of our token limit. In this case we must
            // be adding a single message with MORE tokens than half of our token limit.
            // Include the full message. The maximum message size is 400kb. If we assume 1
            // character per bytes that's 400k characters which is approximately 100k
            // tokens using the [one-token-is-about-four-characters rule of thumb][1].
            // GPT-5's context window is 400k tokens so a max length message would consume
            // a quarter of the context window which is not ideal but still fine.
            //
            // [1]: https://platform.openai.com/tokenizer
            if (
                totalTokenCount > limitTokenCount / 2 &&
                totalTokenCount + tokenCount > limitTokenCount
            ) {
                // Agent messages are added in reverse order. So reverse them back to get the
                // correct order.
                messages.reverse();

                return messages;
            } else {
                totalTokenCount += tokenCount;

                messages.push(message);
            }
        }
    }

    // Agent messages are added in reverse order. So reverse them back to get the
    // correct order.
    messages.reverse();

    return messages;
}

async function loadNewMessagesInChatGptAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    // We don't want to use `request.event.index` in this function. So omit it from
    // the type.
    request: Omit<AgentWebhookRequest, "event">,
    state: ChatGptAgentConversationStateStore,
    newMessageIndex: number,
): Promise<void> {
    const initialCursor = state.get().lastMessageIndex;
    if (initialCursor === null) return;

    // There are no new messages to load!
    if (newMessageIndex <= initialCursor) return;

    let cursor = initialCursor;
    const messages: Array<AgentMessage> = [];

    outer: while (newMessageIndex > cursor) {
        const {
            data: {nextCursor, messages: currentMessages},
        } = await getApiMessagesFromStart(tracer, request.apiClient, request.room, {
            limit: Math.min(apiMessagesLimit, newMessageIndex - cursor),
            cursor,
        });

        for (const currentMessage of currentMessages) {
            // Ignore messages after the index we're looking for.
            if (currentMessage.index > newMessageIndex) break outer;

            // Ignore deleted messages.
            if (currentMessage.payload.type === "Deleted") continue;

            const message = await AgentMessage.new(transaction, {
                spaceId: request.spaceId,
                index: currentMessage.index,
                author: currentMessage.author,
                createdTime: currentMessage.createdTime,
                payload: currentMessage.payload,
            });

            messages.push(message);
        }

        if (nextCursor === null) break;
        cursor = nextCursor;
    }

    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

    await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
        item: {
            role: "user",
            content: printAgentMessagesLog(messages).trimEnd(),
        },
    });

    await state.set(transaction, {
        lastOrderKey: orderKey,
        lastMessageIndex: newMessageIndex,
    });
}

async function createChatGptAgentResponse(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<void> {
    const input = Array.from(
        (await ChatGptAgentConversationItemCollection.list(request.storage)).values(),
        ({item}) => item,
    );

    // TODO(calebmer, #ai): Tool calls to implement:
    //
    // - [ ] Upgrade to reasoning model
    // - [ ] Load mentioned content
    // - [ ] Load previous chat messages
    // - [ ] Load content underneath peek
    // - [ ] Alpine search
    // - [ ] [Web search][1]
    // - [ ] Update/create documents
    // - [ ] Update/create tasks, task collections, and subtasks
    // - [ ] View uploaded files (images mostly)
    // - [ ] Forget context tool or force compaction tool (if user feels like
    //       bot is going off the rails)
    //
    // [1]: https://platform.openai.com/docs/guides/tools-web-search
    //
    // TODO(calebmer, #ai): How do we enable the AI to mention users and other
    // content? We can include a mention database but what if they try to mention
    // something new?
    //
    // [1]: https://platform.openai.com/docs/guides/tools-web-search
    const {output} = await request.openAiClient.get().createResponse(tracer, {
        model: "gpt-4o-mini",
        prompt_cache_key: `${request.spaceId}:${request.event.roomPath}`,
        safety_identifier: request.event.authorId,

        // Load the entire conversation history and use that as our input to OpenAI.
        input,
    });

    assert(output.length > 0);

    let markdown = output
        .flatMap(outputItem => {
            if (outputItem.type !== "message") return [];

            return outputItem.content.map(content => {
                if (content.type === "refusal") {
                    return content.refusal;
                } else {
                    return content.text ?? "";
                }
            });
        })
        .join("\n");

    // Often OpenAI will start and end its response with `<bot name="ChatGPT">` and
    // `</bot>` respectively. Mirroring the format seen in our instructions and in
    // the chat context. Remove these start/end tags as they shouldn't show up in
    // the output.
    markdown = markdown.replace(/^\s*<bot(?: [^>]*)?>\s*/, "").replace(/\s*<\/bot>\s*$/, "");

    const markdownTree = parseMarkdownTree(markdown, {
        // For our mention syntax we use `[Alice][]` even when there's no matching
        // definition. This is technically incompatible with CommonMark. If ChatGPT
        // tries to output a mention in this format we want to parse it back properly.
        // Which requires allowing our Markdown parser to parse links with undefined
        // references.
        allowUndefinedLinkReferenceIdentifiers: true,
    });

    let content = parseApiContentFromMarkdownTree(markdownTree, {spaceId: request.spaceId});

    // Convert all straight quotes (`'` and `"`) into proper curly quotes
    // (`“`, `”`, `‘`, `’`). Since LLMs typically only output straight quotes.
    // Curly quotes are proper typography and are consistent with text written in
    // Alpine where we automatically convert quotes into curly quotes.
    content = convertApiContentToProperQuotes(content);

    await request.storage.transaction(async transaction => {
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
        } = await createApiMessage(tracer, request.apiClient, request.room, {content});

        // We're going to update our conversation with the output directly from OpenAI
        // and set `lastMessageIndex` to the new message's index. Make sure if there
        // were any messages added while we were generating our response that we add
        // them to the conversation so they're not missed.
        await loadNewMessagesInChatGptAgentConversation(
            tracer,
            transaction,
            request,
            state,
            message.index - 1,
        );

        const orderKeys = generateOrderKeysBetween(state.get().lastOrderKey, null, output.length);

        for (let index = 0; index < output.length; index++) {
            const orderKey = orderKeys[index]!;
            const outputItem = output[index]!;

            await ChatGptAgentConversationItemCollection.put(transaction, orderKey, {
                item: outputItem,
            });
        }

        await state.set(transaction, {
            lastOrderKey: orderKeys[orderKeys.length - 1]!,
            lastMessageIndex: message.index,
        });
    });
}
