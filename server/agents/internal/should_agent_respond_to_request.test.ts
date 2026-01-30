import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {shouldAgentRespondToRequest} from "~/server/agents/internal/should_agent_respond_to_request.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.getRoot().startSpan("test-span");

const apiClient = new ApiClientMock();

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

describe("shouldAgentRespondToRequest", () => {
    test("returns true when agent is mentioned", async () => {
        const agentAccountId = generateId<AccountId>();

        const request: AgentWebhookRequest = {
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
                type: "NewMessage",
                room: {type: "Chat", id: generateId<ChatId>()},
                index: 0,
                authorId: agentAccountId,
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

        const request: AgentWebhookRequest = {
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
                type: "NewMessage",
                room: {type: "Chat", id: chatId},
                index: 1,
                authorId: agentAccountId,
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
            data: {
                spaceId: generateId<SpaceId>(),
                chat: {
                    id: chatId,
                    members: [
                        {account: createApiAccountMock({id: agentAccountId})},
                        {account: createApiAccountMock({id: otherAccountId})},
                    ],
                },
            },
        });

        const request: AgentWebhookRequest = {
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
                type: "NewMessage",
                wasMentioned: false,
                room: {type: "Chat", id: chatId},
                index: 0,
                authorId: otherAccountId,
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

            const request: AgentWebhookRequest = {
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
                    type: "NewMessage",
                    room: {type: "Post", id: generateId<PostId>()},
                    index: 0,
                    authorId: agentAccountId,
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
                data: {
                    spaceId: generateId<SpaceId>(),
                    chat: {
                        id: chatId,
                        members: [
                            {account: createApiAccountMock({id: agentAccountId})},
                            {account: createApiAccountMock({id: otherAccountId})},
                        ],
                    },
                },
            });

            const request: AgentWebhookRequest = {
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
                    type: "NewMessage",
                    wasMentioned: false,
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    authorId: otherAccountId,
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
                data: {
                    spaceId: generateId<SpaceId>(),
                    chat: {
                        id: chatId,
                        members: [
                            {account: createApiAccountMock({id: agentAccountId})},
                            {account: createApiAccountMock({id: otherAccountId1})},
                            {account: createApiAccountMock({id: otherAccountId2})},
                        ],
                    },
                },
            });

            const request: AgentWebhookRequest = {
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
                    type: "NewMessage",
                    wasMentioned: false,
                    room: {type: "Chat", id: chatId},
                    index: 0,
                    authorId: otherAccountId1,
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
