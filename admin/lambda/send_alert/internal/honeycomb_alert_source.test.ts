import {HoneycombAlertSource} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source.js";
import {HoneycombEventPayload} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source_types.js";
import {printApiContentToMarkdown} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const mockEnv = {
    ALPINE_API_KEY: "test-api-key",
    EDGE_SERVICE_URL: "https://test.cyberworlds.com",
    HONEYCOMB_WEBHOOK_SECRET: "test-honeycomb-secret",
};

const originalEnv = process.env;

let mockHoneycombApiCalls: Array<string> = [];

let mockFetchCalls: Array<{url: string; body: unknown}> = [];

const mockFetch = import.meta.jest.fn().mockImplementation((url: string, options?: any) => {
    if (url.startsWith("https://api.honeycomb.io/")) {
        mockHoneycombApiCalls.push(url);
    }

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

const testSpaceId = "test_space_id_for_snapshots" as SpaceId;

function resetAlertSourceTestEnvironment(): void {
    process.env = {...originalEnv, ...mockEnv};
    mockFetchCalls = [];
    mockHoneycombApiCalls = [];
    global.fetch = mockFetch;
    mockFetch.mockClear();
}

function restoreAlertSourceTestEnvironment(): void {
    process.env = originalEnv;
}

function formatFetchCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as {channelId: string; content: ApiContent};
    const markdown = printApiContentToMarkdown(body.content, {spaceId: testSpaceId});
    return `URL: ${fetchCall.url}
Channel: ${body.channelId}

${markdown}`;
}

async function handleHoneycombPayload(data: HoneycombEventPayload): Promise<void> {
    await new HoneycombAlertSource({body: "", headers: {}}).handlePayload(data);
}

describe("HoneycombAlertSource", () => {
    beforeEach(() => {
        resetAlertSourceTestEnvironment();
    });

    afterEach(() => {
        restoreAlertSourceTestEnvironment();
    });

    const createHoneycombFixture = (
        overrides: Partial<HoneycombEventPayload> = {},
    ): HoneycombEventPayload => ({
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
    });

    describe("authorization", () => {
        test("returns an error when the webhook secret is not configured", () => {
            delete process.env.HONEYCOMB_WEBHOOK_SECRET;

            const authorization = new HoneycombAlertSource({
                body: "{}",
                headers: {"x-honeycomb-webhook-token": "test-honeycomb-secret"},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 500,
                error: "HONEYCOMB_WEBHOOK_SECRET environment variable is not set",
            });
        });

        test("returns an error when the token does not match", () => {
            const authorization = new HoneycombAlertSource({
                body: "{}",
                headers: {"x-honeycomb-webhook-token": "wrong-secret"},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid token",
            });
        });

        test("returns an error when the token is missing", () => {
            const authorization = new HoneycombAlertSource({
                body: "{}",
                headers: {},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid token",
            });
        });

        test("validates a matching token", () => {
            const authorization = new HoneycombAlertSource({
                body: "{}",
                headers: {"x-honeycomb-webhook-token": "test-honeycomb-secret"},
            }).validateAuthorization();

            expect(authorization).toEqual({ok: true});
        });
    });

    test("triggered alert", async () => {
        const payload = createHoneycombFixture({
            alert: {
                instanceId: "alert-instance-456",
                description: "Database connection errors exceeded threshold",
                status: "triggered",
                summary: "Database errors are spiking",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("resolved alert", async () => {
        const payload = createHoneycombFixture({
            alert: {
                instanceId: "alert-instance-456",
                description: "Database connection errors returned to normal",
                status: "ok",
                summary: "Database errors have resolved",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("event alert", async () => {
        const payload = createHoneycombFixture({
            name: "User Signups",
            isEvent: "true",
            description: "New user registration detected",
            alert: {
                instanceId: "event-instance-789",
                description: "User signup event triggered",
                status: "triggered",
                summary: "New user registered",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("event alert with custom emoji", async () => {
        const payload = createHoneycombFixture({
            name: "User Signups",
            isEvent: "true",
            emoji: "🎉",
            description: "New user registration detected",
            alert: {
                instanceId: "event-instance-789",
                description: "User signup event triggered",
                status: "triggered",
                summary: "New user registered",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("staging environment alert", async () => {
        const payload = createHoneycombFixture({
            environment: "staging",
            alert: {
                instanceId: "alert-instance-staging",
                description: "Staging environment issue",
                status: "triggered",
                summary: "Error in staging",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("ignores resolved event alert", async () => {
        const payload = createHoneycombFixture({
            isEvent: "TRUE",
            alert: {
                instanceId: "event-instance-ok",
                description: "Resolved event alert",
                status: "OK",
                summary: "Event alert returned to normal",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("treats numeric isEvent as an event alert", async () => {
        const payload = createHoneycombFixture({
            name: "Deploy Marker",
            isEvent: "1",
            description: "Deploy marker detected",
            alert: {
                instanceId: "event-instance-numeric",
                description: "Deploy marker event triggered",
                status: "triggered",
                summary: "Deploy marker fired",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("falls back to the Honeycomb channel for unsupported channel names", async () => {
        const payload = createHoneycombFixture({
            channel: "unknown-channel",
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("uses the neutral emoji for unknown trigger statuses", async () => {
        const payload = createHoneycombFixture({
            alert: {
                instanceId: "alert-instance-weird-status",
                description: "Database status is neither triggered nor ok",
                status: "degraded",
                summary: "Database status is degraded",
                isTest: false,
            },
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    describe("webhook payload data", () => {
        test("displays groupsTriggered data in a table with keys as headers", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {
                        group: [
                            {key: "error.type", value: "ConnectionError"},
                            {key: "service.name", value: "api-gateway"},
                        ],
                        result: 5,
                    },
                    {
                        group: [
                            {key: "error.type", value: "TimeoutError"},
                            {key: "service.name", value: "database"},
                        ],
                        result: 3,
                    },
                ],
            });

            await handleHoneycombPayload(payload);

            // Should NOT make any Honeycomb API calls
            const honeycombCalls = mockHoneycombApiCalls.filter(url =>
                url.includes("/query_results/"),
            );
            expect(honeycombCalls).toHaveLength(0);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("aggregates by non-user columns and shows user mentions at bottom", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {
                        group: [
                            {key: "error.type", value: "ConnectionError"},
                            {key: "context.known_account.name", value: "Josh Johnson"},
                        ],
                        result: 5,
                    },
                    {
                        group: [
                            {key: "error.type", value: "ConnectionError"},
                            {key: "context.known_account.name", value: "Rachel Date"},
                        ],
                        result: 3,
                    },
                    {
                        group: [
                            {key: "error.type", value: "TimeoutError"},
                            {key: "context.known_account.name", value: "Josh Johnson"},
                        ],
                        result: 2,
                    },
                ],
            });

            await handleHoneycombPayload(payload);

            expect(mockFetchCalls).toHaveLength(1);
            // Should aggregate: ConnectionError=8, TimeoutError=2 Should show user mentions:
            // Josh Johnson, Rachel Date
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("shows only user mentions when context.known_account.name is the only key", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {
                        group: [{key: "context.known_account.name", value: "Josh Johnson"}],
                        result: 5,
                    },
                    {
                        group: [{key: "context.known_account.name", value: "Rachel Date"}],
                        result: 3,
                    },
                ],
            });

            await handleHoneycombPayload(payload);

            expect(mockFetchCalls).toHaveLength(1);
            // Should show only user mentions, no table
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("shows no table when groupsTriggered is empty", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [],
            });

            await handleHoneycombPayload(payload);

            // Should NOT make any Honeycomb API calls
            const honeycombCalls = mockHoneycombApiCalls.filter(url =>
                url.includes("/query_results/"),
            );
            expect(honeycombCalls).toHaveLength(0);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("truncates results to 5 and shows remaining count", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {group: [{key: "error", value: "Error 1"}], result: 1},
                    {group: [{key: "error", value: "Error 2"}], result: 2},
                    {group: [{key: "error", value: "Error 3"}], result: 3},
                    {group: [{key: "error", value: "Error 4"}], result: 4},
                    {group: [{key: "error", value: "Error 5"}], result: 5},
                    {group: [{key: "error", value: "Error 6"}], result: 6},
                    {group: [{key: "error", value: "Error 7"}], result: 7},
                ],
            });

            await handleHoneycombPayload(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("formats exception columns with inline code", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {
                        group: [
                            {key: "exception.message", value: "Connection refused"},
                            {key: "exception.type", value: "NetworkError"},
                            {key: "service.name", value: "api-gateway"},
                        ],
                        result: 5,
                    },
                    {
                        group: [
                            {key: "exception.message", value: "Timeout exceeded"},
                            {key: "exception.type", value: "TimeoutError"},
                            {key: "service.name", value: "database"},
                        ],
                        result: 3,
                    },
                ],
            });

            await handleHoneycombPayload(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });

        test("renders single group as a table", async () => {
            const payload = createHoneycombFixture({
                groupsTriggered: [
                    {
                        group: [
                            {key: "exception.message", value: "Connection refused"},
                            {key: "exception.type", value: "NetworkError"},
                            {key: "service.name", value: "api-gateway"},
                        ],
                        result: 5,
                    },
                ],
            });

            await handleHoneycombPayload(payload);

            expect(mockFetchCalls).toHaveLength(1);
            expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
        });
    });
});
