/* eslint-disable @typescript-eslint/unbound-method */

import {jest} from "@jest/globals";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {
    AgentUsageDatabase,
    AgentUsageDatabaseInterface,
} from "~/server/agents/bots/internal/d1/agent_usage_database.js";

import {refreshAccountEntitlements} from "~/server/agents/bots/internal/refresh_account_entitlements.js";
import {DeadlineExceededError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

// If you update this, be sure to also update the token used in
// app/routes/api.internal.accounts.$accountId.plan.ts
const appServiceAccountPlanSecretToken = "cyberworlds-super-secret-internal-agent-service-token";

// Mock fetch function
const mockFetch = jest.fn<typeof fetch>();

// Mock the database
const mockAgentUsageDatabase: jest.Mocked<AgentUsageDatabaseInterface> = {
    createAgentRequest: jest.fn(),
    getUsedMillicentsByAccountIdSinceTimestamp: jest.fn(),
    getWindowByAccountIdAndType: jest.fn(),
    setWindowByAccountIdAndType: jest.fn(),
    downgradeModelForWindow: jest.fn(),
    getAccountEntitlements: jest.fn(),
    setAccountEntitlements: jest.fn(),
};

const mockAgentUsageDatabaseClass = mockAgentUsageDatabase as unknown as AgentUsageDatabase;

// Mock environment, cloudflare types are tricky in tests So for now, just ignore
// type checking. We don't use them here. This also doesn't fail locally, but fails
// in CI, so we have to use ts-ignore.
const mockEnv: AgentServiceEnv = {
    ChatGptAgentDurableObjectNamespace: {} as any,
    MockChatGptAgentDurableObjectNamespace: {} as any,
    MockCursorAgentDurableObjectNamespace: {} as any,
    CursorAgentDurableObjectNamespace: {} as any,
    AgentUsageDatabase: {} as any,
    API_SERVICE_URL: "https://api.test.cyberworlds.dev",
    EDGE_SERVICE_URL: "https://edge.test.cyberworlds.dev",
    CHAT_GPT_API_SERVICE_KEY: "test-chat-gpt-key",
    CURSOR_API_SERVICE_KEY: "test-cursor-key",
    MOCK_CHAT_GPT_API_SERVICE_KEY: "test-mock-key",
    MOCK_CURSOR_API_SERVICE_KEY: "test-mock-key",
    OPEN_AI_API_KEY: "test-openai-key",
    HONEYCOMB_API_KEY: "test-honeycomb-key",
};

describe("refreshAccountEntitlements", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("successful plan retrieval", () => {
        test("retrieves and sets undefined plan for account without plan", async () => {
            const accountId = generateId<AccountId>();

            // Mock successful API response with undefined plan
            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({plan: undefined}), {
                    status: 200,
                    statusText: "OK",
                    headers: {"content-type": "application/json"},
                }),
            );

            await refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: undefined,
                },
            );
        });

        test("retrieves and sets LifetimeAccess plan for account with plan", async () => {
            const accountId = generateId<AccountId>();

            // Mock successful API response with LifetimeAccess plan
            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({plan: "LifetimeAccess"}), {
                    status: 200,
                    statusText: "OK",
                    headers: {"content-type": "application/json"},
                }),
            );

            await refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: "LifetimeAccess",
                },
            );
        });

        test("handles null plan value as undefined", async () => {
            const accountId = generateId<AccountId>();

            // Mock API response with null plan
            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({plan: null}), {
                    status: 200,
                    statusText: "OK",
                    headers: {"content-type": "application/json"},
                }),
            );

            await refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: undefined,
                },
            );
        });
    });

    describe("error handling and retries", () => {
        beforeEach(() => {
            // Use fake timers to control retry delays
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test("retries on 5xx server errors and eventually succeeds", async () => {
            const accountId = generateId<AccountId>();

            // Mock first call to fail with 500, second to succeed
            mockFetch
                .mockResolvedValueOnce(
                    new Response("Internal Server Error", {
                        status: 500,
                        statusText: "Internal Server Error",
                        headers: {"content-type": "text/plain"},
                    }),
                )
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({plan: "LifetimeAccess"}), {
                        status: 200,
                        statusText: "OK",
                        headers: {"content-type": "application/json"},
                    }),
                );

            // Start the async operation
            const refreshPromise = refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            // Fast-forward time to trigger retry
            await jest.advanceTimersByTimeAsync(5000);

            await refreshPromise;

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: "LifetimeAccess",
                },
            );
        });

        test("retries on 502 Bad Gateway and eventually succeeds", async () => {
            const accountId = generateId<AccountId>();

            // Mock first two calls to fail with 502, third to succeed
            mockFetch
                .mockResolvedValueOnce(
                    new Response("Bad Gateway", {
                        status: 502,
                        statusText: "Bad Gateway",
                        headers: {"content-type": "text/plain"},
                    }),
                )
                .mockResolvedValueOnce(
                    new Response("Bad Gateway", {
                        status: 502,
                        statusText: "Bad Gateway",
                        headers: {"content-type": "text/plain"},
                    }),
                )
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({plan: undefined}), {
                        status: 200,
                        statusText: "OK",
                        headers: {"content-type": "application/json"},
                    }),
                );

            // Start the async operation
            const refreshPromise = refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            // Fast-forward time to trigger retries
            await jest.advanceTimersByTimeAsync(20000);

            await refreshPromise;

            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: undefined,
                },
            );
        });

        test("does not retry on 4xx client errors", async () => {
            const accountId = generateId<AccountId>();

            // Mock 404 response (should not retry)
            mockFetch.mockResolvedValue(
                new Response(
                    JSON.stringify({
                        ok: false,
                        error: {
                            name: "NotFoundError",
                            message: `Account not found: ${accountId}`,
                        },
                    }),
                    {
                        status: 404,
                        statusText: "Not Found",
                        headers: {"content-type": "application/json"},
                    },
                ),
            );

            await refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: undefined,
                },
            );
        });

        test("fails after max retry attempts with 5xx errors", async () => {
            const accountId = generateId<AccountId>();

            // Mock all calls to fail with 500 - need fresh Response objects each time
            mockFetch.mockImplementation(() =>
                Promise.resolve(
                    new Response("Internal Server Error", {
                        status: 500,
                        statusText: "Internal Server Error",
                        headers: {"content-type": "text/plain"},
                    }),
                ),
            );

            // Start the async operation
            const refreshPromise = refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            // Fast-forward time through all retry attempts (5 attempts = ~31 seconds with
            // exponential backoff)
            await jest.advanceTimersByTimeAsync(60000);

            await expect(refreshPromise).rejects.toThrow(DeadlineExceededError);

            // Should have attempted 5 times (max retry attempts)
            expect(mockFetch).toHaveBeenCalledTimes(5);
            expect(mockAgentUsageDatabase.setAccountEntitlements).not.toHaveBeenCalled();
        });

        test("handles network errors with retries", async () => {
            const accountId = generateId<AccountId>();

            // Mock network error, then success
            mockFetch
                .mockResolvedValueOnce(
                    new Response("Internal Server Error", {
                        status: 500,
                        statusText: "Internal Server Error",
                        headers: {"content-type": "text/plain"},
                    }),
                )
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({plan: "LifetimeAccess"}), {
                        status: 200,
                        statusText: "OK",
                        headers: {"content-type": "application/json"},
                    }),
                );

            // Start the async operation
            const refreshPromise = refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            // Fast-forward time to allow retry mechanism to retry
            await jest.advanceTimersByTimeAsync(10000);

            await refreshPromise;

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockAgentUsageDatabase.setAccountEntitlements).toHaveBeenCalledWith(
                expect.anything(),
                accountId,
                {
                    plan: "LifetimeAccess",
                },
            );
        });
    });

    describe("request details", () => {
        test("makes request to correct URL with proper headers", async () => {
            const accountId = generateId<AccountId>();

            mockFetch.mockResolvedValue(
                new Response(JSON.stringify({plan: undefined}), {
                    status: 200,
                    statusText: "OK",
                    headers: {"content-type": "application/json"},
                }),
            );

            await refreshAccountEntitlements(
                testTracer,
                mockEnv,
                mockAgentUsageDatabaseClass,
                accountId,
                {fetch: mockFetch as typeof fetch},
            );

            expect(mockFetch).toHaveBeenCalledWith(expect.any(Request));

            // Get the actual request that was made
            const requestCall = mockFetch.mock.calls[0];
            const request = requestCall![0] as Request;

            expect(request.url).toBe(
                new URL(
                    `/api/internal/accounts/${accountId}/plan`,
                    mockEnv.EDGE_SERVICE_URL,
                ).toString(),
            );
            expect(request.method).toBe("GET");
            expect(request.headers.get("authorization")).toBe(
                `Bearer ${appServiceAccountPlanSecretToken}`,
            );
        });
    });
});
