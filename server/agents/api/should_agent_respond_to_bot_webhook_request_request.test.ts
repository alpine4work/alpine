import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {shouldAgentRespondToApiBotWebhookRequest} from "~/server/agents/api/should_agent_respond_to_bot_webhook_request.js";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {
    ApiBotWebhookEvent,
    ApiChat,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, ChatId, PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.getRoot().startSpan("test-span");

const apiClient = new ApiClientMock();

const ApiChatCollection = new DurableObjectStorageCollection<ChatId, ApiChat>("a0");

// Have to case as any here since Miniflare's DurableObjectStorage type is not
// assignable to the global DurableObjectStorage type we use in the
// `AgentWebhookRequest`.
let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

afterEach(async () => {
    await storage.deleteAll();
});

type TestEvent = {
    readonly apiClient: ApiClientMock;
    readonly storage: DurableObjectStorage;
    readonly botAccountId: AccountId;
    readonly event: Extract<ApiBotWebhookEvent, {type: "CreatedMessage" | "CreatedPost"}>;
    readonly [key: string]: unknown;
};

async function shouldAgentRespondToRequest(
    tracer: typeof span,
    request: TestEvent,
): Promise<boolean> {
    return await shouldAgentRespondToApiBotWebhookRequest(
        tracer,
        request.apiClient,
        request.botAccountId,
        request.event,
        {
            withChatCache: async (chatId, action) =>
                await ApiChatCollection.getOrPutDefault(request.storage, chatId, action),
        },
    );
}

describe("shouldAgentRespondToRequest", () => {
    test("returns true when agent is mentioned", async () => {
        const agentAccountId = generateId<AccountId>();

        const request: TestEvent = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: {} as any,
            agentUsageDatabase: {} as any,
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId: generateId<SpaceId>(),
            botId: generateId<BotId>(),
            botAccountId: agentAccountId,
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: generateId<ChatId>()},
                index: 0,
                author: {id: agentAccountId},
                wasMentioned: true,
                createdTimeZone: defaultTimeZone,
            },
            room: {
                type: "Chat",
                id: generateId<ChatId>(),
            },
        };

        const result = await shouldAgentRespondToRequest(span, request);

        expect(result).toBe(true);
    });

    test("returns true when user is responding to agent\u2019s message", async () => {
        const agentAccountId = generateId<AccountId>();
        const chatId = generateId<ChatId>();

        const request: TestEvent = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: {} as any,
            agentUsageDatabase: {} as any,
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId: generateId<SpaceId>(),
            botId: generateId<BotId>(),
            botAccountId: agentAccountId,
            event: {
                type: "CreatedMessage",
                room: {type: "Chat", id: chatId},
                index: 1,
                author: {id: agentAccountId},
                createdTimeZone: defaultTimeZone,
                wasMentioned: false,
                parent: {
                    type: "Message",
                    index: 0,
                    author: {id: agentAccountId},
                },
            },
            room: {
                type: "Chat",
                id: chatId,
            },
        };

        const result = await shouldAgentRespondToRequest(span, request);

        expect(result).toBe(true);
    });

    test("caches chat data in storage for subsequent calls", async () => {
        const agentAccountId = generateId<AccountId>();
        const otherAccountId = generateId<AccountId>();
        const chatId = generateId<ChatId>();

        apiClient.mockGet("/chats/{id}", {
            params: "Any",
            data: {
                spaceId: generateId<SpaceId>(),
                chat: {
                    type: "Direct",
                    id: chatId,
                    members: [
                        {account: createApiAccountMock({id: agentAccountId})},
                        {account: createApiAccountMock({id: otherAccountId})},
                    ],
                    reference: {title: "Direct chat"},
                },
            },
        });

        const request: TestEvent = {
            storage,
            apiClient,
            apiAccessToken: "test-access-token",
            openAiClient: {} as any,
            agentUsageDatabase: {} as any,
            origin: "https://agent-service.cyberworlds.workers.dev",
            spaceId: generateId<SpaceId>(),
            botId: generateId<BotId>(),
            botAccountId: agentAccountId,
            event: {
                type: "CreatedMessage",
                wasMentioned: false,
                room: {type: "Chat", id: chatId},
                index: 0,
                author: {id: otherAccountId},
                createdTimeZone: defaultTimeZone,
            },
            room: {
                type: "Chat",
                id: chatId,
            },
        };

        // First call should fetch from API
        const result1 = await shouldAgentRespondToRequest(span, request);
        expect(result1).toBe(true);

        // Second call should use cached data (no additional API mock needed)
        const result2 = await shouldAgentRespondToRequest(span, request);
        expect(result2).toBe(true);
    });

    describe("when agent is not mentioned and user is not responding to agent", () => {
        test("returns false for Post rooms", async () => {
            const agentAccountId = generateId<AccountId>();

            const request: TestEvent = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId: generateId<SpaceId>(),
                botId: generateId<BotId>(),
                botAccountId: agentAccountId,
                event: {
                    type: "CreatedMessage",
                    room: {type: "Post", id: generateId<PostId>()},
                    index: 0,
                    author: {id: agentAccountId},
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: false,
                },
                room: {
                    type: "Post",
                    id: generateId<PostId>(),
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(false);
        });

        test("returns true for 1:1 chat where agent is a member", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId = generateId<AccountId>();
            const chatId = generateId<ChatId>();

            apiClient.mockGet("/chats/{id}", {
                params: "Any",
                data: {
                    spaceId: generateId<SpaceId>(),
                    chat: {
                        type: "Direct",
                        id: chatId,
                        members: [
                            {account: createApiAccountMock({id: agentAccountId})},
                            {account: createApiAccountMock({id: otherAccountId})},
                        ],
                        reference: {title: "Direct chat"},
                    },
                },
            });

            const request: TestEvent = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId: generateId<SpaceId>(),
                botId: generateId<BotId>(),
                botAccountId: agentAccountId,
                event: {
                    type: "CreatedMessage",
                    wasMentioned: false,
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: otherAccountId},
                    createdTimeZone: defaultTimeZone,
                },
                room: {
                    type: "Chat",
                    id: chatId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(true);
        });

        test("returns false for group chat with more than 2 members", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId1 = generateId<AccountId>();
            const otherAccountId2 = generateId<AccountId>();
            const chatId = generateId<ChatId>();

            apiClient.mockGet("/chats/{id}", {
                params: "Any",
                data: {
                    spaceId: generateId<SpaceId>(),
                    chat: {
                        type: "Direct",
                        id: chatId,
                        members: [
                            {account: createApiAccountMock({id: agentAccountId})},
                            {account: createApiAccountMock({id: otherAccountId1})},
                            {account: createApiAccountMock({id: otherAccountId2})},
                        ],
                        reference: {title: "Direct chat"},
                    },
                },
            });

            const request: TestEvent = {
                storage,
                apiClient,
                apiAccessToken: "test-access-token",
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                origin: "https://agent-service.cyberworlds.workers.dev",
                spaceId: generateId<SpaceId>(),
                botId: generateId<BotId>(),
                botAccountId: agentAccountId,
                event: {
                    type: "CreatedMessage",
                    wasMentioned: false,
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    author: {id: otherAccountId1},
                    createdTimeZone: defaultTimeZone,
                },
                room: {
                    type: "Chat",
                    id: chatId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(false);
        });
    });
});
