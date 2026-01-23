import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {shouldAgentRespondToRequest} from "~/server/agents/internal/should_agent_respond_to_request.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChatId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.getRoot().startSpan("test-span");

const apiClient = new ApiClientMock();

const messageWithoutParentData = {
    data: {
        spaceId: generateId<SpaceId>(),
        message: {
            payload: {
                type: "Content",
                content: {elements: []},
            },
            author: createApiAccountMock({id: generateId<AccountId>()}),
            createdTime: serializeDateString(new Date()),
            createdTimeZone: defaultTimeZone,
            index: 1,
        },
    },
} as const;

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
    function mockGetPostCommentWithoutParent(): void {
        apiClient.mockGet("/posts/{id}/messages/{index}", messageWithoutParentData);
    }
    function mockGetChatMessageWithoutParent(): void {
        apiClient.mockGet("/chats/{id}/messages/{index}", messageWithoutParentData);
    }

    test("returns true when agent is mentioned", async () => {
        const agentAccountId = generateId<AccountId>();

        const request: AgentWebhookRequest = {
            storage,
            apiClient,
            openAiClient: {} as any,
            agentUsageDatabase: {} as any,
            spaceId: generateId<SpaceId>(),
            accountId: agentAccountId,
            event: {
                type: "NewMessage",
                roomPath: `/chats/${generateId<ChatId>()}`,
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

    test("caches chat data in storage for subsequent calls", async () => {
        const agentAccountId = generateId<AccountId>();
        const otherAccountId = generateId<AccountId>();
        const chatId = generateId<ChatId>();

        mockGetChatMessageWithoutParent();
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
            openAiClient: {} as any,
            agentUsageDatabase: {} as any,
            spaceId: generateId<SpaceId>(),
            accountId: agentAccountId,
            event: {
                type: "NewMessage",
                wasMentioned: false,
                roomPath: `/chats/${chatId}`,
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

        mockGetChatMessageWithoutParent();
        // Second call should use cached data (no additional API mock needed)
        const result2 = await shouldAgentRespondToRequest(span, request);
        expect(result2).toBe(true);
    });

    describe("when agent is not mentioned", () => {
        test("returns false for Post rooms", async () => {
            const agentAccountId = generateId<AccountId>();

            mockGetPostCommentWithoutParent();

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    roomPath: `/posts/${generateId<PostId>()}`,
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

            mockGetChatMessageWithoutParent();
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
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    wasMentioned: false,
                    roomPath: `/chats/${chatId}`,
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

            mockGetChatMessageWithoutParent();
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
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    wasMentioned: false,
                    roomPath: `/chats/${chatId}`,
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

    describe("when message is a response to agent", () => {
        test("returns true when message parent was authored by the agent", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId = generateId<AccountId>();
            const postId = generateId<PostId>();

            apiClient.mockGet("/posts/{id}/messages/{index}", {
                data: {
                    spaceId: generateId<SpaceId>(),
                    message: {
                        index: 1,
                        author: createApiAccountMock({id: otherAccountId}),
                        createdTime: serializeDateString(new Date()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: {
                                type: "Post",
                                author: createApiAccountMock({id: agentAccountId}),
                                contentSnippet: {
                                    elements: [{type: "Text", text: "snippet"}],
                                    isTruncated: false,
                                },
                            },
                            content: {elements: []},
                        },
                    },
                },
            });

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    roomPath: `/posts/${postId}`,
                    index: 1,
                    authorId: otherAccountId,
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: false,
                },
                room: {
                    type: "Post",
                    id: postId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(true);
        });

        test("returns false when message parent was authored by someone else", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId = generateId<AccountId>();
            const thirdAccountId = generateId<AccountId>();
            const postId = generateId<PostId>();

            apiClient.mockGet("/posts/{id}/messages/{index}", {
                data: {
                    spaceId: generateId<SpaceId>(),
                    message: {
                        index: 1,
                        author: createApiAccountMock({id: otherAccountId}),
                        createdTime: serializeDateString(new Date()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            parent: {
                                type: "Post",
                                author: createApiAccountMock({id: thirdAccountId}),
                                contentSnippet: {
                                    elements: [{type: "Text", text: "snippet"}],
                                    isTruncated: false,
                                },
                            },
                            content: {elements: []},
                        },
                    },
                },
            });

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    roomPath: `/posts/${postId}`,
                    index: 1,
                    authorId: otherAccountId,
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: false,
                },
                room: {
                    type: "Post",
                    id: postId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(false);
        });

        test("returns false when message has no parent", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId = generateId<AccountId>();
            const postId = generateId<PostId>();

            apiClient.mockGet("/posts/{id}/messages/{index}", {
                data: {
                    spaceId: generateId<SpaceId>(),
                    message: {
                        index: 1,
                        author: createApiAccountMock({id: otherAccountId}),
                        createdTime: serializeDateString(new Date()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: {elements: []},
                        },
                    },
                },
            });

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    roomPath: `/posts/${postId}`,
                    index: 1,
                    authorId: otherAccountId,
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: false,
                },
                room: {
                    type: "Post",
                    id: postId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(false);
        });

        test("returns false when message payload is Deleted", async () => {
            const agentAccountId = generateId<AccountId>();
            const otherAccountId = generateId<AccountId>();
            const postId = generateId<PostId>();

            apiClient.mockGet("/posts/{id}/messages/{index}", {
                data: {
                    spaceId: generateId<SpaceId>(),
                    message: {
                        index: 1,
                        author: createApiAccountMock({id: otherAccountId}),
                        createdTime: serializeDateString(new Date()),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Deleted",
                        },
                    },
                },
            });

            const request: AgentWebhookRequest = {
                storage,
                apiClient,
                openAiClient: {} as any,
                agentUsageDatabase: {} as any,
                spaceId: generateId<SpaceId>(),
                accountId: agentAccountId,
                event: {
                    type: "NewMessage",
                    roomPath: `/posts/${postId}`,
                    index: 1,
                    authorId: otherAccountId,
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: false,
                },
                room: {
                    type: "Post",
                    id: postId,
                },
            };

            const result = await shouldAgentRespondToRequest(span, request);

            expect(result).toBe(false);
        });
    });
});
