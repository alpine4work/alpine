import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {handleChatGptAgentApprovalDecisionWebhookEventIfPossible} from "~/server/agents/bots/internal/deprecated/approvals/handle_chat_gpt_agent_approval_decision_webhook_event_if_possible.js";
import {AgentUsageDatabaseInterface} from "~/server/agents/bots/internal/d1/agent_usage_database.js";
import {OpenAiClientInterface} from "~/server/agents/bots/internal/open_ai_client.js";
import {
    ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent,
    ApiMessageExperimentalApprovalDecisionValueResponse,
    ApiMessageExperimentalApprovalResponse,
    ApiMessageRoomReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.getRoot().startSpan("test-span");

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();
const botId = generateId<BotId>();
const botAccountId = generateId<AccountId>();
const deciderAccountId = generateId<AccountId>();

const room: ApiMessageRoomReference = {type: "Chat", id: chatId};
const messageIndex = 3;
const approvalsPath = "/chats/{id}/messages/{index}/experimental-approvals";
const approvalsParams = {path: {id: chatId, index: messageIndex}};

// Have to cast as any here since Miniflare's DurableObjectStorage type is not
// assignable to the global DurableObjectStorage type we use in the
// `AgentWebhookRequest`.
let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

afterEach(async () => {
    await storage.deleteAll();
});

const apiClient = new ApiClientMock();

function createApprovalsPartEvent(): ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent {
    return {
        type: "UpdatedMessageStreamExperimentalApprovalsPart",
        room,
        messageIndex,
        approvals: [
            {decision: {value: {type: "Approved", decider: {account: {id: deciderAccountId}}}}},
        ],
    };
}

function createWebhookRequest() {
    return {
        storage,
        apiClient,
        apiAccessToken: "test-access-token",
        openAiClient: new Lazy<OpenAiClientInterface>(() => {
            throw new InternalError("`openAiClient` should not be used in this test");
        }),
        agentUsageDatabase: new Lazy<AgentUsageDatabaseInterface>(() => {
            throw new InternalError("`agentUsageDatabase` should not be used in this test");
        }),
        origin: "https://test.alpine.inc",
        spaceId,
        botId,
        botAccountId,
        room,
        event: createApprovalsPartEvent(),
    };
}

const approvalDecisionOptions = [{type: "Approved"} as const, {type: "Rejected"} as const];

function createApiApprovalResponse(
    value?: ApiMessageExperimentalApprovalDecisionValueResponse,
): ApiMessageExperimentalApprovalResponse {
    return {
        summary: {elements: [{type: "Text", text: "Create a document"}]},
        decision: {schema: {options: approvalDecisionOptions}, value},
    };
}

function createApprovedValueResponse(): ApiMessageExperimentalApprovalDecisionValueResponse {
    return {type: "Approved", decider: {account: {id: deciderAccountId}}};
}

function createRejectedValueResponse(): ApiMessageExperimentalApprovalDecisionValueResponse {
    return {type: "Rejected", decider: {account: {id: deciderAccountId}}};
}

// These tests run with no pending approval record in storage. The handler then
// treats the agent state as unrecoverable and converges by rejecting whatever the
// API still reports as pending for the event's message.
describe("handleChatGptAgentApprovalDecisionWebhookEventIfPossible without a stored approval", () => {
    test("rejects only the approvals the API still reports as pending", async () => {
        apiClient.mockGet(approvalsPath, {
            params: approvalsParams,
            data: {
                spaceId,
                approvals: [
                    createApiApprovalResponse(createApprovedValueResponse()),
                    createApiApprovalResponse(),
                    createApiApprovalResponse(),
                ],
            },
        });
        apiClient.mockPatch(approvalsPath, {
            params: approvalsParams,
            data: {
                spaceId,
                approvals: [
                    createApiApprovalResponse(createApprovedValueResponse()),
                    createApiApprovalResponse(createRejectedValueResponse()),
                    createApiApprovalResponse(createRejectedValueResponse()),
                ],
            },
        });

        await handleChatGptAgentApprovalDecisionWebhookEventIfPossible(
            span,
            createWebhookRequest(),
        );

        const patchRequests = apiClient
            .getRequestHistory()
            .filter(record => record.method === "PATCH");
        expect(patchRequests).toMatchObject([
            {
                body: {
                    patches: [
                        {type: "SetDecisionValue", index: 1, decision: {value: {type: "Rejected"}}},
                        {type: "SetDecisionValue", index: 2, decision: {value: {type: "Rejected"}}},
                    ],
                },
            },
        ]);
    });

    test("doesn\u2019t patch when the API reports every approval as decided", async () => {
        apiClient.mockGet(approvalsPath, {
            params: approvalsParams,
            data: {
                spaceId,
                approvals: [createApiApprovalResponse(createRejectedValueResponse())],
            },
        });

        await handleChatGptAgentApprovalDecisionWebhookEventIfPossible(
            span,
            createWebhookRequest(),
        );

        expect(apiClient.getCallCount("PATCH", approvalsPath)).toBe(0);
    });

    test("returns the stored-approval-not-found error", async () => {
        apiClient.mockGet(approvalsPath, {
            params: approvalsParams,
            data: {
                spaceId,
                approvals: [createApiApprovalResponse(createRejectedValueResponse())],
            },
        });

        const result = await handleChatGptAgentApprovalDecisionWebhookEventIfPossible(
            span,
            createWebhookRequest(),
        );

        expect(result).toMatchObject({
            ok: false,
            error: expect.objectContaining({
                message: `Couldn\u2019t find approval item for the message with index ${messageIndex}`,
            }),
        });
    });

    test("still returns the stored-approval-not-found error when fetching the approvals fails", async () => {
        apiClient.mockGet(approvalsPath, {
            params: approvalsParams,
            error: new InternalError("API request failed", {
                cause: {
                    status: 500,
                    error: {message: "Something went wrong.", retry: {able: false}},
                },
            }),
        });

        const result = await handleChatGptAgentApprovalDecisionWebhookEventIfPossible(
            span,
            createWebhookRequest(),
        );

        expect(result).toMatchObject({
            ok: false,
            error: expect.objectContaining({
                message: `Couldn\u2019t find approval item for the message with index ${messageIndex}`,
            }),
        });
    });
});
