import {createHmac} from "crypto";
import {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {HoneycombTriggerPayload} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source_types.js";
import {handler} from "~/admin/lambda/send_alert/send_alert_lambda.js";

type LambdaFunctionUrlResult = {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
};

const originalEnv = process.env;

let mockFetchCalls: Array<{url: string; body: unknown}> = [];

const mockFetch = import.meta.jest.fn().mockImplementation((url: string, options?: any) => {
    if (options?.body) {
        mockFetchCalls.push({
            url,
            body: JSON.parse(options.body),
        });
    }

    return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(""),
    });
});

function createHoneycombPayload(
    overrides: Partial<HoneycombTriggerPayload> = {},
): HoneycombTriggerPayload {
    return {
        name: "Database Connection Error",
        channel: "honeycomb",
        isEvent: "false",
        emoji: "",
        id: "hc-alert-123",
        description: "High error rate detected in database connections",
        environment: "production",
        links: {
            trigger: "https://ui.honeycomb.io/cyberworlds/triggers/db-error-trigger",
            result: "https://ui.honeycomb.io/cyberworlds/environments/production/result/znqGGwhdYP6/a/pwzJA4FzA1C",
        },
        threshold: {
            op: ">",
            value: "5",
        },
        result: {
            groupsTriggered: [],
        },
        alert: {
            instanceId: "alert-instance-456",
            description: "Database connection errors exceeded threshold",
            status: "triggered",
            summary: "Database errors are spiking",
            isTest: false,
        },
        ...overrides,
    };
}

function createEvent(overrides: Partial<AlertSourceRequest> = {}): AlertSourceRequest {
    return {
        body: JSON.stringify(createHoneycombPayload()),
        headers: {"x-honeycomb-webhook-token": "test-honeycomb-secret"},
        httpMethod: "POST",
        isBase64Encoded: false,
        requestContext: {
            http: {
                method: "POST",
                path: "/",
                sourceIp: "127.0.0.1",
            },
        },
        ...overrides,
    };
}

async function callHandler(
    event: AlertSourceRequest,
): Promise<Omit<LambdaFunctionUrlResult, "body"> & {body: unknown}> {
    const result = (await handler(event, {} as any, () => undefined)) as LambdaFunctionUrlResult;

    return {
        ...result,
        body: JSON.parse(result.body),
    };
}

function createGitHubSignature(body: string): string {
    const hmac = createHmac("sha256", "test-github-secret");
    hmac.update(body);
    return `sha256=${hmac.digest("hex")}`;
}

describe("send alert lambda", () => {
    beforeEach(() => {
        process.env = {
            ...originalEnv,
            ALPINE_API_KEY: "test-api-key",
            EDGE_SERVICE_URL: "https://test.cyberworlds.com",
            HONEYCOMB_WEBHOOK_SECRET: "test-honeycomb-secret",
            GITHUB_ACTIONS_WEBHOOK_SECRET: "test-github-secret",
        };
        mockFetchCalls = [];
        global.fetch = mockFetch;
        mockFetch.mockClear();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test("returns an error when EDGE_SERVICE_URL is not configured", async () => {
        delete process.env.EDGE_SERVICE_URL;

        const result = await callHandler(createEvent());

        expect(result).toMatchObject({
            statusCode: 500,
            body: {
                ok: false,
                error: "EDGE_SERVICE_URL environment variable is not set",
            },
        });
    });

    test("returns an error when request body is missing", async () => {
        const result = await callHandler(createEvent({body: undefined}));

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Request body is required"},
        });
    });

    test("returns an error for unsupported headers", async () => {
        const result = await callHandler(createEvent({headers: {}}));

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Invalid headers"},
        });
    });

    test("returns an error when multiple source headers are present", async () => {
        const result = await callHandler(
            createEvent({
                headers: {
                    "x-honeycomb-webhook-token": "test-honeycomb-secret",
                    "x-hub-signature-256": "sha256=signature",
                },
            }),
        );

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Invalid headers"},
        });
    });

    test("returns an authorization error from the alert source", async () => {
        const result = await callHandler(
            createEvent({headers: {"x-honeycomb-webhook-token": "wrong-secret"}}),
        );

        expect(result).toMatchObject({
            statusCode: 401,
            body: {ok: false, error: "Invalid token"},
        });
    });

    test("returns an error for invalid JSON", async () => {
        const result = await callHandler(createEvent({body: "{"}));

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Invalid JSON in request body"},
        });
    });

    test("returns a source processing error", async () => {
        delete process.env.ALPINE_API_KEY;

        const result = await callHandler(createEvent());

        expect(result).toMatchObject({
            statusCode: 500,
            body: {
                ok: false,
                error: "ALPINE_API_KEY is not set in environment variables",
            },
        });
    });

    test("returns a GitHub source processing error", async () => {
        const body = "{}";
        const result = await callHandler(
            createEvent({
                body,
                headers: {"x-hub-signature-256": createGitHubSignature(body)},
            }),
        );

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Missing X-GitHub-Event header"},
        });
    });

    test("processes a valid request", async () => {
        const result = await callHandler(createEvent());

        expect({
            result,
            fetchCalls: mockFetchCalls.length,
        }).toMatchObject({
            result: {
                statusCode: 200,
                body: {ok: true, message: "Alert processed successfully"},
            },
            fetchCalls: 1,
        });
    });

    test("pins the Alpine API version for requests", async () => {
        await callHandler(createEvent());

        expect(mockFetch).toHaveBeenCalledWith(
            "https://api.test.cyberworlds.com/posts",
            expect.objectContaining({
                headers: {
                    "Alpine-Version": "2026-07-29",
                    "Content-Type": "application/json",
                    Authorization: "Bearer test-api-key",
                },
            }),
        );
    });
});
