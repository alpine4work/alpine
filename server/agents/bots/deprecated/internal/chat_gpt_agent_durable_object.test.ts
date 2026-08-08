/* eslint-disable @typescript-eslint/unbound-method */

import {jest} from "@jest/globals";
import {
    DurableObjectId,
    DurableObjectState,
    DurableObjectStorage,
} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import OpenAi from "openai";
import {putApiMessageStreamPartBeforeFetchTestCheckpoint} from "~/server/agents/api/api_client.open_source.js";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    ChatGptAgentDurableObject,
    createChatGptAgentResponseAfterPushTextTestCheckpoint,
    injectCurrentlyViewedEntityIntoContextIfNeededForTest,
} from "~/server/agents/bots/deprecated/internal/chat_gpt_agent_durable_object.js";
import {
    ChatGptAgentConversationItemCollection,
    ChatGptAgentConversationStore,
} from "~/server/agents/bots/deprecated/internal/conversation/chat_gpt_agent_conversation_store.js";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {AgentUsageDatabaseInterface} from "~/server/agents/bots/internal/d1/agent_usage_database.js";
import {OpenAiClientInterface} from "~/server/agents/bots/internal/open_ai_client.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {InternalError, NotFoundError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {assertDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChatId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// Have to case as any here since Miniflare's DurableObjectStorage type is not
// assignable to the global DurableObjectStorage type we use in the
// `AgentWebhookRequest`.
let storage: any;

const {span} = testTracer.getRoot().startSpan("test-span");

function createChatGptAgentDurableObject() {
    const id = new DurableObjectId("test-id", "test-name");
    const state = new DurableObjectState(id, storage) as any;

    return new ChatGptAgentDurableObject(state, {
        CHAT_GPT_API_SERVICE_KEY: "test-key",
        API_SERVICE_URL: "https://api.test.com",
        OPEN_AI_API_KEY: "test-openai-key",
    } as any);
}

/**
 * Creates a keyed API paragraph fixture for agent response content.
 */
function createApiResponseParagraph(text: string) {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
    }).elements[0]!;
}

// Shared mock for usage database - reset in afterEach
const mockAgentUsageDatabase: jest.Mocked<AgentUsageDatabaseInterface> = {
    createAgentRequest: jest.fn(),
    getUsedMillicentsByAccountIdSinceTimestamp: jest.fn(),
    getWindowByAccountIdAndType: jest.fn(),
    setWindowByAccountIdAndType: jest.fn(),
    downgradeModelForWindow: jest.fn(),
    getAccountEntitlements: jest.fn(),
    setAccountEntitlements: jest.fn(),
};

const mockOpenAiClient: jest.Mocked<OpenAiClientInterface> = {
    createResponse: jest.fn(),
    createResponseWithStreaming: jest.fn(),
};

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-12-30T12:00:00.000Z"));
});

afterEach(async () => {
    await storage.deleteAll();
    jest.clearAllMocks();
    jest.useRealTimers();
});

function mockAgentUsageForAccount(authorId: AccountId) {
    // ----- Mock usage database (no limits) -----
    const now = Date.now();
    // Calculate week start (Sunday 00:00 UTC)
    const weekStartDate = new Date(now);
    weekStartDate.setUTCHours(0, 0, 0, 0);
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
    const weekStart = weekStartDate.getTime();

    mockAgentUsageDatabase.getAccountEntitlements.mockResolvedValue(null);
    // Return existing windows so the code doesn't try to create new ones
    mockAgentUsageDatabase.getWindowByAccountIdAndType.mockImplementation(
        async (_span, _accountId, type) => {
            if (type === "Weekly") {
                return {
                    accountId: authorId,
                    type: "Weekly",
                    startedTime: weekStart,
                    wasModelDowngraded: false,
                };
            }
            if (type === "Dynamic") {
                return {
                    accountId: authorId,
                    type: "Dynamic",
                    startedTime: now - 1000,
                    wasModelDowngraded: false,
                };
            }
            return null;
        },
    );
    mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(0);
    mockAgentUsageDatabase.createAgentRequest.mockResolvedValue(undefined);
}

function mockOpenAiStreamingResponse(
    events: Array<
        | {type: "Wait"; delayMs: number}
        | Pick<OpenAi.Responses.ResponseOutputItemDoneEvent, "item" | "type">
        | Pick<OpenAi.Responses.ResponseTextDeltaEvent, "delta" | "type">
        | Pick<OpenAi.Responses.ResponseReasoningSummaryPartDoneEvent, "part" | "type">
        | (Pick<OpenAi.Responses.ResponseCompletedEvent, "type"> & {
              response?: Pick<OpenAi.Responses.Response, "usage">;
          })
        | {type: "Error"; error: Error}
    >,
) {
    mockOpenAiClient.createResponseWithStreaming.mockImplementationOnce(
        async function* (): AsyncIterableIterator<{
            span: TracerSpan;
            event: OpenAi.Responses.ResponseStreamEvent;
        }> {
            const {span: parentSpan, finishSpan} = testTracer.startSpan(
                "Mock OpenAI create response (streaming)",
            );

            try {
                for (const event of events) {
                    switch (event.type) {
                        case "Wait":
                            await jest.advanceTimersByTimeAsync(event.delayMs);
                            break;
                        case "response.completed":
                            yield {
                                span: parentSpan,
                                event: {
                                    type: "response.completed",
                                    response: event.response ?? {
                                        usage: {
                                            input_tokens: 100,
                                            output_tokens: 50,
                                            total_tokens: 150,
                                            input_tokens_details: {cached_tokens: 0},
                                            output_tokens_details: {reasoning_tokens: 0},
                                        },
                                    },
                                } as OpenAi.Responses.ResponseCompletedEvent,
                            };
                            break;
                        case "response.reasoning_summary_part.done":
                            yield {
                                span: parentSpan,
                                event: {
                                    type: "response.reasoning_summary_part.done",
                                    part: event.part,
                                } as OpenAi.Responses.ResponseReasoningSummaryPartDoneEvent,
                            };
                            break;
                        case "response.output_text.delta":
                            yield {
                                span: parentSpan,
                                event: {
                                    type: "response.output_text.delta",
                                    delta: event.delta,
                                } as OpenAi.Responses.ResponseTextDeltaEvent,
                            };
                            break;
                        case "response.output_item.done":
                            yield {
                                span: parentSpan,
                                event: {
                                    type: "response.output_item.done",
                                    item: event.item,
                                } as OpenAi.Responses.ResponseOutputItemDoneEvent,
                            };
                            break;
                        case "Error":
                            throw event.error;
                        default:
                            throw exhaustive(event);
                    }
                }
            } catch (error) {
                parentSpan.addException(error);
                throw error;
            } finally {
                finishSpan();
            }
        },
    );
}

describe("ChatGptAgentDurableObject.webhook", () => {
    const apiClient = new ApiClientMock();
    const spaceId = generateId<SpaceId>();
    const chatId = generateId<ChatId>();
    const authorId = generateId<AccountId>();
    const botId = generateId<BotId>();

    let clearIntervalSpy: jest.SpiedFunction<typeof clearInterval>;

    beforeEach(() => {
        clearIntervalSpy = jest.spyOn(global, "clearInterval");

        apiClient.spy("POST", "/chats/{id}/messages");
        apiClient.spy("PUT", "/chats/{id}/messages/{index}/stream/parts/{partIndex}");
        apiClient.spy("PUT", "/chats/{id}/messages/{index}/stream/completion");
        apiClient.spy("PUT", "/chats/{id}/messages/{index}/stream/ping");
    });

    afterEach(() => {
        clearIntervalSpy.mockRestore();
    });

    test("processes a message and streams a response", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "response.output_text.delta",
                delta: "Hello! How can I help?",
            },
            {type: "Wait", delayMs: 7000},
            {
                type: "response.output_text.delta",
                delta: " Would you like to know more about the weather in Tokyo?",
            },
            {type: "Wait", delayMs: 6000},
            {
                type: "response.completed",
            },
        ]);

        // ----- Create the webhook request -----
        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();
        mockAgentUsageForAccount(authorId);

        // create the bot's response message, needs to be mocked because we need the index
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        // get space info for system prompt
        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {
                space: {
                    id: spaceId,
                    name: "Test Space",
                },
            },
        });

        // fetch conversation history for context
        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest(
                                addKeysToApiContentForTest({
                                    elements: [createApiResponseParagraph("Hello")],
                                }),
                            ),
                            files: [],
                        },
                    },
                ],
            },
        });

        await durableObject.webhook(span, request);

        // ===== ASSERT =====

        // Verify the sequence of API calls
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {
                        elements: [],
                    },
                    isStream: true,
                }),
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello! How can I help?"}],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Hello! How can I help? Would you like to know more about the weather in Tokyo?",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),

            // // Initializes the conversation
        ]);

        // Verify OpenAI was called
        expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(1);

        // Verify usage was recorded
        expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                accountId: authorId,
                spaceId,
                provider: "openai",
                model: "gpt-5.4",
            }),
        );

        // Verify clearInterval was called Cleared once after first content part is
        // received and sent cleared once again after the second content part is sent
        // cleared after the complete is sent
        expect(clearIntervalSpy).toHaveBeenCalledTimes(3);
    });

    test("still sends message when usage limit check throws an exception", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "response.output_text.delta",
                delta: "Hello! I can still help you.",
            },
            {type: "response.completed"},
        ]);

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        // ===== ACT =====
        const durableObject = createChatGptAgentDurableObject();

        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {
                space: {id: spaceId, name: "Test Space"},
            },
        });

        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest({
                                elements: [createApiResponseParagraph("Hello")],
                            }),
                            files: [],
                        },
                    },
                ],
            },
        });

        // ----- Mock usage database -----
        const now = Date.now();
        const weekStartDate = new Date(now);
        weekStartDate.setUTCHours(0, 0, 0, 0);
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
        const weekStart = weekStartDate.getTime();

        mockAgentUsageDatabase.getAccountEntitlements.mockResolvedValue(null);
        mockAgentUsageDatabase.getWindowByAccountIdAndType.mockImplementation(
            async (_span, _accountId, type) => {
                if (type === "Weekly") {
                    return {
                        accountId: authorId,
                        type: "Weekly",
                        startedTime: weekStart,
                        wasModelDowngraded: false,
                    };
                }
                if (type === "Dynamic") {
                    return {
                        accountId: authorId,
                        type: "Dynamic",
                        startedTime: now - 1000,
                        wasModelDowngraded: false,
                    };
                }
                return null;
            },
        );
        // First calls succeed (for isAgentUsageLimitExceeded), then throw (for
        // shouldDowngradeModelForAgentUsageLimit)
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp
            .mockResolvedValueOnce(0) // Weekly limit check
            .mockResolvedValueOnce(0) // Dynamic limit check
            .mockRejectedValue(new InternalError("D1 database unavailable")); // Model downgrade check
        mockAgentUsageDatabase.createAgentRequest.mockResolvedValue(undefined);

        await durableObject.webhook(span, request);

        // ===== ASSERT =====

        // Verify OpenAI was still called despite the usage check failing
        expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(1);

        // Verify the full sequence of API calls
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {elements: []},
                    isStream: true,
                }),
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Hello! I can still help you."},
                                    ],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify clearInterval was called Content was sent and stream was completed at
        // same time `update` is throttled so that it happens 100ms later via timeout
        // before update runs, `finally` runs and clears the interval when update runs,
        // there is no interval to clear!
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });

    test("cleans up ping interval even when OpenAI throws mid-stream", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "response.output_text.delta",
                delta: "Hello!",
            },
            {type: "Wait", delayMs: 6000},
            {type: "Error", error: new InternalError("OpenAI connection lost")},
        ]);

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();
        mockAgentUsageForAccount(authorId);

        // ----- Mock API responses -----
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {space: {id: spaceId, name: "Test Space"}},
        });

        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest({
                                elements: [createApiResponseParagraph("Hello")],
                            }),
                            files: [],
                        },
                    },
                ],
            },
        });

        // ===== ACT ===== The webhook should throw due to the OpenAI error
        await expect(durableObject.webhook(span, request)).rejects.toThrow(
            "OpenAI connection lost",
        );

        // ===== ASSERT =====

        // Verify the API calls that were made before the error
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {elements: []},
                    isStream: true,
                }),
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            // First stream part was sent before the error
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: expect.objectContaining({
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello!"}],
                                },
                            ],
                        },
                    }),
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: expect.objectContaining({
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Hello!I couldn\u2019t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at ",
                                        },
                                        {
                                            type: "Text",
                                            text: "support@alpine.inc",
                                            marks: [
                                                {type: "Link", url: "mailto:support@alpine.inc"},
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    }),
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify clearInterval was called even though an error occurred
        //
        // - content comes in and `update()` runs 100ms later, clearing the interval and
        //   starting a new one after update completes
        // - 2 seconds later, stream fails, `finally` runs and clears the current interval
        expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    });

    test("streams reasoning summary when OpenAI provides reasoning", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "Wait",
                delayMs: 6000,
            },
            {
                type: "response.reasoning_summary_part.done",
                part: {
                    type: "summary_text",
                    text: "I should greet the user warmly.",
                },
            },
            {
                type: "Wait",
                delayMs: 6000,
            },
            {
                type: "response.output_text.delta",
                delta: "Hello there!",
            },
            {
                type: "response.completed",
                response: {
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        total_tokens: 150,
                        input_tokens_details: {cached_tokens: 0},
                        output_tokens_details: {reasoning_tokens: 10},
                    },
                },
            },
        ]);

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();
        mockAgentUsageForAccount(authorId);

        // ----- Mock API responses -----
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {space: {id: spaceId, name: "Test Space"}},
        });

        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest({
                                elements: [createApiResponseParagraph("Hello")],
                            }),
                            files: [],
                        },
                    },
                ],
            },
        });

        // ===== ACT =====
        await durableObject.webhook(span, request);

        // ===== ASSERT =====
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {elements: []},
                    isStream: true,
                }),
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            // Reasoning summary streamed first
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "Reasoning",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "I should greet the user warmly."},
                                    ],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            // Then the text response
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 1}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello there!"}],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify clearInterval was called
        //
        // - reasoning tool call immediately clears updateTimeout and sends the reasoning
        //   summary this clears the interval and starts a new one
        // - content comes in and `update()` is scheduled to run 100ms later
        // - stream is completed, `finally` runs and clears the current interval
        // - `update()` runs but there is no interval to clear!
        expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    });

    test("chains search_alpine and read_link tool calls, aggregating usage across all calls", async () => {
        const documentId = generateId<DocumentId>();

        // First call to OpenAI
        mockOpenAiStreamingResponse([
            {
                type: "Wait",
                delayMs: 6000,
            },
            {
                type: "response.output_item.done",
                item: {
                    type: "function_call",
                    id: "fc_search",
                    call_id: "call_search",
                    name: "search_alpine",
                    arguments: JSON.stringify({query: "AI document"}),
                },
            },
            {
                type: "response.completed",
                response: {
                    usage: {
                        input_tokens: 100,
                        output_tokens: 15,
                        total_tokens: 115,
                        input_tokens_details: {cached_tokens: 0},
                        output_tokens_details: {reasoning_tokens: 0},
                    },
                },
            },
        ]);

        // second call to OpenAI
        mockOpenAiStreamingResponse([
            {
                type: "Wait",
                delayMs: 4500,
            },
            {
                type: "response.output_item.done",
                item: {
                    type: "function_call",
                    id: "fc_read",
                    call_id: "call_read",
                    name: "read_link",
                    arguments: JSON.stringify({path: "/document/ai-overview"}),
                },
            },
            {
                type: "response.completed",
                response: {
                    usage: {
                        input_tokens: 200,
                        output_tokens: 20,
                        total_tokens: 220,
                        input_tokens_details: {cached_tokens: 80},
                        output_tokens_details: {reasoning_tokens: 0},
                    },
                },
            },
        ]);

        // final call to OpenAI
        mockOpenAiStreamingResponse([
            {
                type: "response.output_text.delta",
                delta: "The AI Overview document explains artificial intelligence concepts.",
            },
            {
                type: "Wait",
                delayMs: 6000,
            },
            {
                type: "response.completed",
                response: {
                    usage: {
                        input_tokens: 300,
                        output_tokens: 25,
                        total_tokens: 325,
                        input_tokens_details: {cached_tokens: 150},
                        output_tokens_details: {reasoning_tokens: 0},
                    },
                },
            },
        ]);

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();

        mockAgentUsageForAccount(authorId);

        // ----- Mock API responses -----
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {space: {id: spaceId, name: "Test Space"}},
        });

        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    createApiResponseParagraph("Find and read the AI document"),
                                ],
                            },
                            files: [],
                        },
                    },
                ],
            },
        });

        // Mock the search API endpoint
        apiClient.mockGet("/spaces/{id}/search", {
            params: "Any",
            data: {
                results: [
                    {
                        type: "Document",
                        id: documentId,
                        title: "AI Overview",
                        matches: [],
                        bodySnippet: null,
                        parsedFilter: undefined,
                    },
                ],
            },
        });

        // Mock the document API endpoint for read_link
        apiClient.mockGet("/documents/{id}", {
            params: "Any",
            data: {
                spaceId,
                document: {
                    id: documentId,
                    title: "AI Overview",
                    version: 1,
                    content: {
                        elements: [
                            createApiResponseParagraph(
                                "This document explains artificial intelligence concepts.",
                            ),
                        ],
                    },
                },
            },
        });

        // ===== ACT =====
        await durableObject.webhook(span, request);

        // ===== ASSERT =====

        // Verify OpenAI was called 3 times (search, read, final response)
        expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(3);

        // Verify the full sequence of API calls
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {elements: []},
                    isStream: true,
                }),
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            // Search API called by first tool
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}/search",
                params: {
                    path: {id: spaceId},
                    query: {query: "AI document", limit: 10},
                },
            }),
            // First tool call streamed (Search)
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "ToolCall",
                        call: {type: "Search", query: "AI document"},
                    },
                },
            }),
            // Document API called by second tool
            expect.objectContaining({
                method: "GET",
                path: "/documents/{id}",
                params: {path: {id: documentId}},
            }),
            // Second tool call streamed (Read)
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 1}},
                body: {
                    payload: {
                        type: "ToolCall",
                        call: {type: "Read", reference: {type: "Document", id: documentId}},
                    },
                },
            }),
            // Final text response streamed
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 2}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "The AI Overview document explains artificial intelligence concepts.",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/ping",
                params: {path: {id: chatId, index: 1}},
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify usage was aggregated correctly across all 3 OpenAI calls Call 1:
        // (100-0)*0.25 + 0*0.025 + 15*1.5 = 25 + 0 + 22.5 = 47.5 millicents Call 2:
        // (200-80)*0.25 + 80*0.025 + 20*1.5 = 30 + 2 + 30 = 62 millicents Call 3:
        // (300-150)*0.25 + 150*0.025 + 25\*1.5 = 37.5 + 3.75 + 37.5 = 78.75 millicents
        // Total: Math.floor(47.5 + 62 + 78.75) = Math.floor(188.25) = 188 millicents
        expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                accountId: authorId,
                spaceId,
                provider: "openai",
                model: "gpt-5.4",
                usedMillicents: 188,
            }),
        );

        // Verify clearInterval was called
        //
        // - search tool call immediately clears updateTimeout and sends the search results
        //   this clears the interval and starts a new one
        // - next comes a read tool call which also bypasses any update throttling and
        //   sends the read results. Clears interval and starts a new one
        // - content comes in and `update()` is scheduled to run 100ms later
        // - 100ms later, `update()` runs and clears the interval. Then resets it
        // - stream is completed, `finally` runs and clears the current interval
        expect(clearIntervalSpy).toHaveBeenCalledTimes(4);
    });

    test("sends only limit exceeded message when usage limit is exceeded (no OpenAI call)", async () => {
        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();

        // ----- Mock API responses -----
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        // ----- Mock usage database to indicate limit exceeded -----
        const now = Date.now();
        const weekStartDate = new Date(now);
        weekStartDate.setUTCHours(0, 0, 0, 0);
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
        const weekStart = weekStartDate.getTime();

        // Weekly limit: $2.00 = 200,000 millicents, duration 7 days
        const weeklyLimitMillicents = 200000;

        mockAgentUsageDatabase.getAccountEntitlements.mockResolvedValue(null);
        mockAgentUsageDatabase.getWindowByAccountIdAndType.mockImplementation(
            async (_span, _accountId, type) => {
                if (type === "Weekly") {
                    return {
                        accountId: authorId,
                        type: "Weekly",
                        startedTime: weekStart,
                        wasModelDowngraded: false,
                    };
                }
                if (type === "Dynamic") {
                    return {
                        accountId: authorId,
                        type: "Dynamic",
                        startedTime: now - 1000,
                        wasModelDowngraded: false,
                    };
                }
                return null;
            },
        );
        // Return usage OVER the limit (weekly limit is $2.00 = 200,000 millicents)
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            weeklyLimitMillicents + 1000,
        );
        mockAgentUsageDatabase.createAgentRequest.mockResolvedValue(undefined);

        // ===== ACT =====
        await durableObject.webhook(span, request);

        // ===== ASSERT =====

        // Verify OpenAI was NOT called
        expect(mockOpenAiClient.createResponseWithStreaming).not.toHaveBeenCalled();

        // Verify the full sequence of API calls
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
            }),
            // Doesn't initialize the conversation
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: expect.objectContaining({
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            text: "You\u2019ve reached your agent usage limit. Your limit will reset on Jan 3rd at 7:00pm. You can get higher usage limits by purchasing ",
                                            type: "Text",
                                        },
                                        {
                                            marks: [
                                                {
                                                    type: "Link",
                                                    url: "https://www.alpine.inc#pricing",
                                                },
                                            ],
                                            text: "Alpine lifetime access",
                                            type: "Text",
                                        },
                                        {
                                            text: ".",
                                            type: "Text",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                }),
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify no usage was recorded (no OpenAI call = no usage)
        expect(mockAgentUsageDatabase.createAgentRequest).not.toHaveBeenCalled();
        // Verify clearInterval was called
        //
        // - should only be called once after sending the last message stream part
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });

    test("sends response with downgrade warning when user hits 75% usage threshold", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "Wait",
                delayMs: 1000,
            },
            {
                type: "response.output_text.delta",
                delta: "Hello! How can I help?",
            },
            {
                type: "response.completed",
                response: {
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        total_tokens: 150,
                        input_tokens_details: {cached_tokens: 0},
                        output_tokens_details: {reasoning_tokens: 0},
                    },
                },
            },
        ]);

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();

        // ----- Mock API responses -----
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: 1,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {space: {id: spaceId, name: "Test Space"}},
        });

        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest({
                                elements: [createApiResponseParagraph("Hello")],
                            }),
                            files: [],
                        },
                    },
                ],
            },
        });

        // ----- Mock usage database to indicate 75%+ usage (triggers downgrade) -----
        const now = Date.now();
        const weekStartDate = new Date(now);
        weekStartDate.setUTCHours(0, 0, 0, 0);
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
        const weekStart = weekStartDate.getTime();

        // Dynamic limit: $1.00 = 100,000 millicents 80% of that = 80,000 millicents
        // (downgrade threshold)
        const dynamicLimitMillicents = 100000;

        mockAgentUsageDatabase.getAccountEntitlements.mockResolvedValue(null);
        mockAgentUsageDatabase.getWindowByAccountIdAndType.mockImplementation(
            async (_span, _accountId, type) => {
                if (type === "Weekly") {
                    return {
                        accountId: authorId,
                        type: "Weekly",
                        startedTime: weekStart,
                        wasModelDowngraded: false, // Not yet downgraded - will trigger alert
                    };
                }
                if (type === "Dynamic") {
                    return {
                        accountId: authorId,
                        type: "Dynamic",
                        startedTime: now - 1000,
                        wasModelDowngraded: false,
                    };
                }
                return null;
            },
        );
        // Return usage at 80% of limit (above 75% downgrade threshold, below 100%)
        mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
            Math.floor(dynamicLimitMillicents * 0.8),
        );
        mockAgentUsageDatabase.createAgentRequest.mockResolvedValue(undefined);
        mockAgentUsageDatabase.downgradeModelForWindow.mockResolvedValue(undefined);

        // ===== ACT =====
        await durableObject.webhook(span, request);

        // ===== ASSERT =====

        // Verify OpenAI was called with the downgraded model
        expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(1);
        expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({model: "gpt-5.4-mini"}),
        );

        // Verify the full sequence of API calls
        const apiCalls = apiClient.getRequestHistory();
        expect(apiCalls).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
            }),
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
            }),
            // The actual response from OpenAI
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: expect.objectContaining({
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Hello! How can I help?"}],
                                },
                            ],
                        },
                    },
                }),
            }),
            // The downgrade warning message appended after the response
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 1}},
                body: expect.objectContaining({
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "(To help extend your usage, I\u2019m now using a less intelligent model. I\u2019ll be back to using the best available model today at 2:59pm. If you\u2019d like to continue using the most intelligent models, purchase ",
                                        },
                                        {
                                            type: "Text",
                                            text: "Alpine lifetime access",
                                            marks: [
                                                {
                                                    type: "Link",
                                                    url: "https://www.alpine.inc#pricing",
                                                },
                                            ],
                                        },
                                        {
                                            type: "Text",
                                            text: ".)",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                }),
            }),
            expect.objectContaining({
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
            }),
        ]);

        // Verify downgradeModelForWindow was called to mark the window as downgraded
        expect(mockAgentUsageDatabase.downgradeModelForWindow).toHaveBeenCalledWith(
            expect.anything(),
            authorId,
            "Dynamic",
        );

        // Verify usage was recorded with the downgraded model
        expect(mockAgentUsageDatabase.createAgentRequest).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                accountId: authorId,
                spaceId,
                provider: "openai",
                model: "gpt-5.4-mini", // Downgraded model
            }),
        );
    });

    describe("retry on corrupted state or context length exceeded", () => {
        // Helper to create a mock Headers object for OpenAI errors
        const createMockHeaders = () => ({get: () => null}) as unknown as Headers;
        let deleteStorageSpy: jest.SpiedFunction<typeof storage.deleteAll>;

        beforeEach(() => {
            deleteStorageSpy = jest.spyOn(storage, "deleteAll");
        });

        afterEach(() => {
            deleteStorageSpy.mockRestore();
        });

        test("clears durable object state and retries when OpenAI returns BadRequestError", async () => {
            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.BadRequestError(
                        400,
                        {error: {message: "Bad request", type: "invalid_request_error"}},
                        "Bad request",
                        createMockHeaders(),
                    ),
                },
            ]);

            mockOpenAiStreamingResponse([
                {
                    type: "response.output_text.delta",
                    delta: "Hello after retry!",
                },
                {type: "response.completed"},
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();
            mockAgentUsageForAccount(authorId);

            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            // Mock spaces endpoint twice - once for initial call, once for retry
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            // Mock messages endpoint twice - once for initial call, once for retry
            const mockGetMessagesResponse = {
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            } as const;
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});

            await durableObject.webhook(span, request);

            // Verify storage.deleteAll was called to clear corrupted state
            expect(deleteStorageSpy).toHaveBeenCalledTimes(1);

            // Verify OpenAI was called twice (first failed, second succeeded)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(2);

            // Verify the response was streamed successfully after retry
            const apiCalls = apiClient.getRequestHistory();
            expect(apiCalls).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                // STATE WAS CLEARED AND CONVO IS BEING REINITIALIZED
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Hello after retry!"}],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);
        });

        test("clears durable object state and retries when OpenAI returns NotFoundError", async () => {
            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.NotFoundError(
                        404,
                        {error: {message: "Not found", type: "invalid_request_error"}},
                        "Not found",
                        createMockHeaders(),
                    ),
                },
            ]);

            mockOpenAiStreamingResponse([
                {
                    type: "response.output_text.delta",
                    delta: "Recovered from not found!",
                },
                {type: "response.completed"},
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();
            mockAgentUsageForAccount(authorId);

            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            // Mock spaces endpoint twice - once for initial call, once for retry
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            // Mock messages endpoint twice
            const mockGetMessagesResponse = {
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            } as const;
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});

            await durableObject.webhook(span, request);

            // Verify storage.deleteAll was called to clear corrupted state
            expect(deleteStorageSpy).toHaveBeenCalledTimes(1);

            // Verify OpenAI was called twice (first failed, second succeeded)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(2);

            // Verify the response was streamed successfully after retry
            const apiCalls = apiClient.getRequestHistory();
            expect(apiCalls).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                // STATE WAS CLEARED AND CONVO IS BEING REINITIALIZED
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Recovered from not found!"},
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);
        });

        test("clears durable object state and retries when OpenAI returns context_length_exceeded error", async () => {
            const documentId = generateId<DocumentId>();

            // first request to open AI hits window limit
            mockOpenAiStreamingResponse([
                {
                    type: "response.reasoning_summary_part.done",
                    part: {
                        type: "summary_text",
                        text: "I should greet the user warmly.",
                    },
                },
                {
                    type: "response.output_item.done",
                    item: {
                        type: "function_call",
                        id: "fc_search",
                        call_id: "call_search",
                        name: "search_alpine",
                        arguments: JSON.stringify({query: "AI document"}),
                    },
                },
                {type: "response.completed"},
            ]);

            // Second request to OpenAI is the tool call, the output of which pushes the agent
            // past the context length limit
            mockOpenAiStreamingResponse([
                {type: "Wait", delayMs: 6000},
                {
                    type: "Error",
                    error: new OpenAi.APIError(
                        400,
                        {
                            message: "Context length exceeded",
                            type: "invalid_request_error",
                            code: "context_length_exceeded",
                        },
                        "Context length exceeded",
                        createMockHeaders(),
                    ),
                },
            ]);

            // NOTE: This will actually fail because the link references no longer exist. We
            // won't see a read call to the API!!
            mockOpenAiStreamingResponse([
                {type: "Wait", delayMs: 6000},
                {
                    type: "response.output_item.done",
                    item: {
                        type: "function_call",
                        id: "fc_read",
                        call_id: "call_read",
                        name: "read_link",
                        arguments: JSON.stringify({path: "/documents/ai-overview"}),
                    },
                },
                {type: "response.completed"},
            ]);

            // Handle errors
            mockOpenAiStreamingResponse([
                {
                    type: "response.reasoning_summary_part.done",
                    part: {type: "summary_text", text: "Continuing..."},
                },
                {
                    type: "response.output_text.delta",
                    delta: "Recovered from context length exceeded!",
                },
                {type: "response.completed"},
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();
            mockAgentUsageForAccount(authorId);

            // Creates the message for the message stream
            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            // Mock spaces endpoint twice - once for initial call, once for retry
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            apiClient.mockGet("/spaces/{id}/search", {
                params: "Any",
                data: {
                    results: [
                        {
                            type: "Document",
                            id: documentId,
                            title: "AI Overview",
                            matches: [],
                            bodySnippet: null,
                            parsedFilter: undefined,
                        },
                    ],
                },
            });

            // Mock messages endpoint twice - once for initial call, once for retry
            const mockGetMessagesResponse = {
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            } as const;
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});

            const deleteAllSpy = jest.spyOn(storage, "deleteAll");

            await durableObject.webhook(span, request);

            // Verify storage.deleteAll was called to clear state
            expect(deleteAllSpy).toHaveBeenCalled();

            // Verify OpenAI was called twice (first failed, second succeeded)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(4);

            // Verify the response was streamed successfully after retry
            const apiCalls = apiClient.getRequestHistory();
            expect(apiCalls).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    body: expect.objectContaining({
                        content: {elements: []},
                        isStream: true,
                    }),
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 0}},
                    body: {
                        payload: {
                            type: "Reasoning",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "I should greet the user warmly."},
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}/search",
                    params: {path: {id: spaceId}, query: {query: "AI document", limit: 10}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 1}},
                    body: {
                        payload: {
                            type: "ToolCall",
                            call: {type: "Search", query: "AI document"},
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/ping",
                    params: {path: {id: chatId, index: 1}},
                }),
                // STATE WAS CLEARED AND CONVO IS BEING REINITIALIZED
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/ping",
                    params: {path: {id: chatId, index: 1}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 2}},
                    body: {
                        payload: {
                            type: "Reasoning",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Continuing..."}],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "Recovered from context length exceeded!",
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                    params: {path: {id: chatId, index: 1, partIndex: 3}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);

            deleteAllSpy.mockRestore();
        });

        test("does not retry more than once (max 2 attempts total)", async () => {
            // Both calls throw BadRequestError
            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.BadRequestError(
                        400,
                        {error: {message: "Persistent bad request", type: "invalid_request_error"}},
                        "Persistent bad request",
                        createMockHeaders(),
                    ),
                },
            ]);

            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.BadRequestError(
                        400,
                        {error: {message: "Persistent bad request", type: "invalid_request_error"}},
                        "Persistent bad request",
                        createMockHeaders(),
                    ),
                },
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();
            mockAgentUsageForAccount(authorId);

            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            // Mock spaces endpoint 3 times - initial call + 2 retries
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            // Mock messages endpoint 3 times - initial call + 2 retries
            const mockGetMessagesResponse = {
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            } as const;
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});

            // Should throw after exhausting retries
            await expect(durableObject.webhook(span, request)).rejects.toThrow(
                "Persistent bad request",
            );

            // Verify storage.deleteAll was called twice (once before each retry attempt)
            expect(deleteStorageSpy).toHaveBeenCalledTimes(1);

            // Verify OpenAI was called 3 times (initial attempt + 2 retries)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(2);

            expect(apiClient.getRequestHistory()).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    body: expect.objectContaining({
                        content: {elements: []},
                        isStream: true,
                    }),
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                // STATE WAS CLEARED AND CONVO IS BEING REINITIALIZED
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 0}},
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "I couldn\u2019t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at ",
                                            },
                                            {
                                                type: "Text",
                                                text: "support@alpine.inc",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "mailto:support@alpine.inc",
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);
        });

        test("does not retry for non-retryable errors", async () => {
            // Throw a non-retryable error (e.g., rate limit)
            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.RateLimitError(
                        429,
                        {error: {message: "Rate limit exceeded", type: "rate_limit_error"}},
                        "Rate limit exceeded",
                        createMockHeaders(),
                    ),
                },
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();
            mockAgentUsageForAccount(authorId);

            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            apiClient.mockGet("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            });

            // Should throw immediately without retrying
            await expect(durableObject.webhook(span, request)).rejects.toThrow(
                "Rate limit exceeded",
            );

            // Verify storage.deleteAll was NOT called (no retry for rate limit errors)
            expect(deleteStorageSpy).not.toHaveBeenCalled();

            // Verify OpenAI was called only once (no retry)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(1);

            expect(apiClient.getRequestHistory()).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    body: expect.objectContaining({
                        content: {elements: []},
                        isStream: true,
                    }),
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 0}},
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "I couldn\u2019t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at ",
                                            },
                                            {
                                                type: "Text",
                                                text: "support@alpine.inc",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "mailto:support@alpine.inc",
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);
        });

        test("only sends downgraded messaging error once", async () => {
            // Both calls throw BadRequestError
            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.BadRequestError(
                        400,
                        {error: {message: "Persistent bad request", type: "invalid_request_error"}},
                        "Persistent bad request",
                        createMockHeaders(),
                    ),
                },
            ]);

            mockOpenAiStreamingResponse([
                {
                    type: "Error",
                    error: new OpenAi.BadRequestError(
                        400,
                        {error: {message: "Persistent bad request", type: "invalid_request_error"}},
                        "Persistent bad request",
                        createMockHeaders(),
                    ),
                },
            ]);

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: new Lazy(() => mockOpenAiClient),
                agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId,
                botId,
                botAccountId: generateId<AccountId>(),
                event: {
                    type: "CreatedMessage",
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: authorId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
                room: {type: "Chat", id: chatId},
            };

            const durableObject = createChatGptAgentDurableObject();

            // ----- Mock usage database to indicate 75%+ usage (triggers downgrade) -----
            const now = Date.now();
            const weekStartDate = new Date(now);
            weekStartDate.setUTCHours(0, 0, 0, 0);
            weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
            const weekStart = weekStartDate.getTime();

            // Dynamic limit: $1.00 = 100,000 millicents 80% of that = 80,000 millicents
            // (downgrade threshold)
            const dynamicLimitMillicents = 100000;

            mockAgentUsageDatabase.getAccountEntitlements.mockResolvedValue(null);
            mockAgentUsageDatabase.getWindowByAccountIdAndType.mockImplementation(
                async (_span, _accountId, type) => {
                    if (type === "Weekly") {
                        return {
                            accountId: authorId,
                            type: "Weekly",
                            startedTime: weekStart,
                            wasModelDowngraded: false, // Not yet downgraded - will trigger alert
                        };
                    }
                    if (type === "Dynamic") {
                        return {
                            accountId: authorId,
                            type: "Dynamic",
                            startedTime: now - 1000,
                            wasModelDowngraded: false,
                        };
                    }
                    return null;
                },
            );
            // Return usage at 80% of limit (above 75% downgrade threshold, below 100%)
            mockAgentUsageDatabase.getUsedMillicentsByAccountIdSinceTimestamp.mockResolvedValue(
                Math.floor(dynamicLimitMillicents * 0.8),
            );
            mockAgentUsageDatabase.createAgentRequest.mockResolvedValue(undefined);
            mockAgentUsageDatabase.downgradeModelForWindow.mockResolvedValue(undefined);

            apiClient.mockPost("/chats/{id}/messages", {
                params: "Any",
                data: {
                    spaceId,
                    message: {
                        index: 1,
                        author: createApiAccountMock({name: "Bot", botId}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {type: "Content", content: {elements: []}, files: []},
                    },
                },
            });

            // Mock spaces endpoint twice - once for initial call, once for retry
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });
            apiClient.mockGet("/spaces/{id}", {
                params: "Any",
                data: {space: {id: spaceId, name: "Test Space"}},
            });

            // Mock messages endpoint 3 times - initial call + 2 retries
            const mockGetMessagesResponse = {
                data: {
                    spaceId,
                    totalMessageCount: 1,
                    nextCursor: null,
                    messages: [
                        {
                            index: 0,
                            author: createApiAccountMock({name: "User"}),
                            createdTime: assertDateString(new Date().toISOString()),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: {
                                    elements: [createApiResponseParagraph("Hello")],
                                },
                                files: [],
                            },
                        },
                    ],
                },
            } as const;
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});
            apiClient.mockGet("/chats/{id}/messages", {params: "Any", ...mockGetMessagesResponse});

            // Should throw after exhausting retries
            await expect(durableObject.webhook(span, request)).rejects.toThrow(
                "Persistent bad request",
            );

            // Verify storage.deleteAll was called twice (once before each retry attempt)
            expect(deleteStorageSpy).toHaveBeenCalledTimes(1);

            // Verify OpenAI was called 3 times (initial attempt + 2 retries)
            expect(mockOpenAiClient.createResponseWithStreaming).toHaveBeenCalledTimes(2);

            expect(apiClient.getRequestHistory()).toEqual([
                expect.objectContaining({
                    method: "POST",
                    path: "/chats/{id}/messages",
                    body: expect.objectContaining({
                        content: {elements: []},
                        isStream: true,
                    }),
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                // STATE WAS CLEARED AND CONVO IS BEING REINITIALIZED
                expect.objectContaining({
                    method: "GET",
                    path: "/spaces/{id}",
                    params: {path: {id: spaceId}},
                }),
                expect.objectContaining({
                    method: "GET",
                    path: "/chats/{id}/messages",
                    params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 0}},
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "(To help extend your usage, I\u2019m now using a less intelligent model. I\u2019ll be back to using the best available model today at 2:59pm. If you\u2019d like to continue using the most intelligent models, purchase ",
                                            },
                                            {
                                                type: "Text",
                                                text: "Alpine lifetime access",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "https://www.alpine.inc#pricing",
                                                    },
                                                ],
                                            },
                                            {
                                                type: "Text",
                                                text: ".)",
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                    params: {path: {id: chatId, index: 1, partIndex: 1}},
                    body: {
                        payload: {
                            type: "Content",
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "(To help extend your usage, I\u2019m now using a less intelligent model. I\u2019ll be back to using the best available model today at 2:59pm. If you\u2019d like to continue using the most intelligent models, purchase ",
                                            },
                                            {
                                                type: "Text",
                                                text: "Alpine lifetime access",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "https://www.alpine.inc#pricing",
                                                    },
                                                ],
                                            },
                                            {
                                                type: "Text",
                                                // TODO(ifitzsimmons, 2026-01-21): This is a super edge case, where the agent
                                                // throws an error in the same request where it downgrades the model. We should
                                                // change this so that there's a break between the two "system" messages.
                                                text: ".)I couldn\u2019t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at ",
                                            },
                                            {
                                                type: "Text",
                                                text: "support@alpine.inc",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "mailto:support@alpine.inc",
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                }),
                expect.objectContaining({
                    method: "PUT",
                    path: "/chats/{id}/messages/{index}/stream/completion",
                }),
            ]);
        });
    });

    test("race condition: `putApiMessageStreamPart()` resolves AFTER we get some output text from OpenAI", async () => {
        mockOpenAiStreamingResponse([
            {
                type: "response.reasoning_summary_part.done",
                part: {
                    type: "summary_text",
                    text: "Reasoning summary part 1.",
                },
            },
            {
                type: "response.reasoning_summary_part.done",
                part: {
                    type: "summary_text",
                    text: "Reasoning summary part 2.",
                },
            },
            {
                type: "response.output_text.delta",
                delta: "Output text delta 1.",
            },
            {
                type: "response.output_text.delta",
                delta: " Output text delta 2.",
            },
            {
                type: "response.output_text.delta",
                delta: " Output text delta 3.",
            },
        ]);

        // ----- Create the webhook request -----
        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
        };

        const durableObject = createChatGptAgentDurableObject();
        mockAgentUsageForAccount(authorId);

        const messageIndex = 1;

        // create the bot's response message, needs to be mocked because we need the index
        apiClient.mockPost("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                message: {
                    index: messageIndex,
                    author: createApiAccountMock({name: "Bot", botId}),
                    createdTime: assertDateString(new Date().toISOString()),
                    createdTimeZone: defaultTimeZone,
                    payload: {type: "Content", content: {elements: []}, files: []},
                },
            },
        });

        // get space info for system prompt
        apiClient.mockGet("/spaces/{id}", {
            params: "Any",
            data: {
                space: {
                    id: spaceId,
                    name: "Test Space",
                },
            },
        });

        // fetch conversation history for context
        apiClient.mockGet("/chats/{id}/messages", {
            params: "Any",
            data: {
                spaceId,
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: createApiAccountMock({name: "User"}),
                        createdTime: assertDateString(new Date().toISOString()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: addKeysToApiContentForTest({
                                elements: [createApiResponseParagraph("Hello")],
                            }),
                            files: [],
                        },
                    },
                ],
            },
        });

        // Pause right before we put "Reasoning summary part 1."
        const pause1Promise = putApiMessageStreamPartBeforeFetchTestCheckpoint.pauseForTest([
            messageIndex,
            0,
        ]);

        // Pause right after we call `pushText()` for "Output text delta 1."
        const pause2Promise =
            createChatGptAgentResponseAfterPushTextTestCheckpoint.pauseForTest(messageIndex);

        const webhookPromise = durableObject.webhook(span, request);

        const {unpause: unpause1} = await pause1Promise;
        const {unpause: unpause2} = await pause2Promise;

        // Simulate `putApiMessageStreamPart()` resolving AFTER we get the first output
        // text from OpenAI.
        unpause1();

        unpause2();
        await webhookPromise;

        // ===== ASSERT =====

        expect(
            apiClient
                .getRequestHistory()
                .map(request => pickObject(request, ["method", "path", "params", "body"])),
        ).toEqual([
            {
                method: "POST",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}},
                body: expect.objectContaining({
                    content: {
                        elements: [],
                    },
                    isStream: true,
                }),
            },
            {
                method: "GET",
                path: "/spaces/{id}",
                params: {path: {id: spaceId}},
                body: undefined,
            },
            {
                method: "GET",
                path: "/chats/{id}/messages",
                params: {path: {id: chatId}, query: {limit: 30, cursor: 1, from: "End"}},
                body: undefined,
            },
            {
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 0}},
                body: {
                    payload: {
                        type: "Reasoning",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Reasoning summary part 1.",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
            {
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 1}},
                body: {
                    payload: {
                        type: "Reasoning",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Reasoning summary part 2.",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
            {
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                params: {path: {id: chatId, index: 1, partIndex: 2}},
                body: {
                    payload: {
                        type: "Content",
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Output text delta 1. Output text delta 2. Output text delta 3.",
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
            {
                method: "PUT",
                path: "/chats/{id}/messages/{index}/stream/completion",
                params: {path: {id: chatId, index: 1}},
                body: undefined,
            },
        ]);
    });
});

describe("injectCurrentlyViewedEntityIntoContextIfNeeded", () => {
    const apiClient = new ApiClientMock();
    const spaceId = generateId<SpaceId>();
    const chatId = generateId<ChatId>();
    const authorId = generateId<AccountId>();
    const botId = generateId<BotId>();
    const documentId = generateId<DocumentId>();

    // Have to cast as any here since Miniflare's DurableObjectStorage type is not
    // assignable to the global DurableObjectStorage type.
    let testStorage: any;

    const mockOpenAiClient: jest.Mocked<OpenAiClientInterface> = {
        createResponse: jest.fn(),
        createResponseWithStreaming: jest.fn(),
    };

    const mockAgentUsageDatabase: jest.Mocked<AgentUsageDatabaseInterface> = {
        createAgentRequest: jest.fn(),
        getUsedMillicentsByAccountIdSinceTimestamp: jest.fn(),
        getWindowByAccountIdAndType: jest.fn(),
        setWindowByAccountIdAndType: jest.fn(),
        downgradeModelForWindow: jest.fn(),
        getAccountEntitlements: jest.fn(),
        setAccountEntitlements: jest.fn(),
    };

    beforeEach(() => {
        testStorage = new DurableObjectStorage(new MemoryStorage());
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2025-12-30T12:00:00.000Z"));
    });

    afterEach(async () => {
        await testStorage.deleteAll();
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    function createBaseRequest(overrides: Partial<AgentWebhookRequest> = {}): AgentWebhookRequest {
        return {
            storage: testStorage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: new Lazy(() => mockOpenAiClient),
            agentUsageDatabase: new Lazy(() => mockAgentUsageDatabase),
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId,
            botId,
            botAccountId: generateId<AccountId>(),
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
            },
            room: {type: "Chat", id: chatId},
            ...overrides,
        };
    }

    test("does nothing when event type is not NewMessage", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify no conversation items were added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(0);
        });
    });

    test("does nothing when viewingTarget is null and there is no previous entity", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const request = createBaseRequest();

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify no conversation items were added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(0);
        });
    });

    test("injects \u2018is looking at\u2019 message when user starts viewing a new entity", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                viewing: {reference: {type: "Document", id: documentId}},
            },
        });

        // Mock the API calls
        apiClient.mockGet("/documents/{id}-reference", {
            params: "Any",
            data: {
                spaceId,
                reference: {type: "Document", id: documentId, title: "Test Document"},
            },
        });

        apiClient.mockGet("/accounts/{id}", {
            params: "Any",
            data: {
                account: createApiAccountMock({name: "Test User"}),
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify a conversation item was added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(1);

            expect(Array.from(items.values())[0]!.item).toMatchObject({
                type: "message",
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: "input_text",
                        text: expect.stringContaining("is looking at"),
                    }),
                ]),
            });

            // Verify state was updated
            expect(conversation.getState().currentlyViewingTarget).toMatchObject({
                target: {
                    type: "Document",
                    id: documentId,
                    title: "Test Document",
                },
                previousTarget: null,
            });
        });
    });

    test("injects \u2018is no longer looking at\u2019 message when user stops viewing an entity", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        // First, set up initial state with a previous entity
        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await conversation.setState(transaction, {
                currentlyViewingTarget: {
                    target: {
                        type: "Document",
                        id: documentId,
                        title: "Test Document",
                    },
                    previousTarget: null,
                    previousInjectTime: new Date("2025-12-30T11:00:00.000Z"),
                },
            });
        });

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                // No viewingTarget - user is no longer viewing anything
            },
        });

        apiClient.mockGet("/accounts/{id}", {
            params: "Any",
            data: {
                account: createApiAccountMock({name: "Test User"}),
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify a conversation item was added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(1);

            expect(Array.from(items.values())[0]!.item).toMatchObject({
                type: "message",
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: "input_text",
                        text: expect.stringContaining("is no longer looking at"),
                    }),
                ]),
            });

            // Verify state was updated - target should now be null
            expect(conversation.getState().currentlyViewingTarget).toMatchObject({
                target: null,
            });
        });
    });

    test("does nothing if user is viewing the same entity within 10 minutes", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const viewingTarget = {
            type: "Document" as const,
            id: documentId,
            title: "Test Document",
        };

        // First, set up initial state with the same entity viewed 5 minutes ago
        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await conversation.setState(transaction, {
                currentlyViewingTarget: {
                    target: viewingTarget,
                    previousTarget: null,
                    previousInjectTime: new Date("2025-12-30T11:55:00.000Z"), // 5 minutes ago
                },
            });
        });

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                viewing: {reference: {type: "Document", id: documentId}},
            },
        });

        // Mock API call for mention (to get the same entity)
        apiClient.mockGet("/documents/{id}-reference", {
            params: "Any",
            data: {
                spaceId,
                reference: viewingTarget,
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify no conversation items were added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(0);
        });
    });

    test("injects \u2018is still looking at\u2019 message if user is viewing the same entity after 10 minutes", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const viewingTarget = {
            type: "Document" as const,
            id: documentId,
            title: "Test Document",
        };

        // First, set up initial state with the same entity viewed 15 minutes ago
        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await conversation.setState(transaction, {
                currentlyViewingTarget: {
                    target: viewingTarget,
                    previousTarget: null,
                    previousInjectTime: new Date("2025-12-30T11:45:00.000Z"), // 15 minutes ago
                },
            });
        });

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                viewing: {reference: {type: "Document", id: documentId}},
            },
        });

        // Mock API calls
        apiClient.mockGet("/documents/{id}-reference", {
            params: "Any",
            data: {
                spaceId,
                reference: viewingTarget,
            },
        });

        apiClient.mockGet("/accounts/{id}", {
            params: "Any",
            data: {
                account: createApiAccountMock({name: "Test User"}),
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify a conversation item was added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(1);

            expect(Array.from(items.values())[0]!.item).toMatchObject({
                type: "message",
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: "input_text",
                        text: expect.stringContaining("is still looking at"),
                    }),
                ]),
            });
        });
    });

    test("injects \u2018is now looking at\u2019 message when user switches from one entity to another", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const previousDocumentId = generateId<DocumentId>();
        const newDocumentId = generateId<DocumentId>();

        const previousTarget = {
            type: "Document" as const,
            id: previousDocumentId,
            title: "Previous Document",
        };

        // First, set up initial state with a different entity
        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await conversation.setState(transaction, {
                currentlyViewingTarget: {
                    target: previousTarget,
                    previousTarget: null,
                    previousInjectTime: new Date("2025-12-30T11:55:00.000Z"),
                },
            });
        });

        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                viewing: {reference: {type: "Document", id: newDocumentId}},
            },
        });

        // Mock API calls
        apiClient.mockGet("/documents/{id}-reference", {
            params: "Any",
            data: {
                spaceId,
                reference: {
                    type: "Document",
                    id: newDocumentId,
                    title: "New Document",
                },
            },
        });

        apiClient.mockGet("/accounts/{id}", {
            params: "Any",
            data: {
                account: createApiAccountMock({name: "Test User"}),
            },
        });

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            // Verify a conversation item was added
            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(1);

            expect(Array.from(items.values())[0]!.item).toMatchObject({
                type: "message",
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: "input_text",
                        text: expect.stringContaining("is now looking at"),
                    }),
                ]),
            });

            // Verify state was updated
            expect(conversation.getState().currentlyViewingTarget).toMatchObject({
                target: {
                    type: "Document",
                    id: newDocumentId,
                    title: "New Document",
                },
                previousTarget: previousTarget,
            });
        });
    });

    test("skips injection without throwing when the mention API returns 404", async () => {
        const {span} = testTracer.getRoot().startSpan("test-span");

        const unresolvableChatId = generateId<ChatId>();
        const request = createBaseRequest({
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: authorId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: true,
                viewing: {reference: {type: "Chat", id: unresolvableChatId}},
            },
        });

        jest.spyOn(apiClient, "get").mockRejectedValueOnce(new NotFoundError("API request failed"));

        await testStorage.transaction(async (transaction: any) => {
            const conversation = await ChatGptAgentConversationStore.new(transaction, {
                initialTimeZone: defaultTimeZone,
            });

            await injectCurrentlyViewedEntityIntoContextIfNeededForTest(
                span,
                request,
                transaction,
                conversation,
            );

            const items = await ChatGptAgentConversationItemCollection.list(transaction);
            expect(items.size).toBe(0);
        });
    });
});

test.todo("approvals");
