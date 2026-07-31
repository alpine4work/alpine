import {createHmac} from "crypto";
import {PagerDutyAlertSource} from "~/admin/lambda/send_alert/internal/pagerduty_alert_source.js";
import {PagerDutyEventPayload} from "~/admin/lambda/send_alert/internal/pagerduty_alert_source_types.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";

const mockEnv = {
    ALPINE_API_KEY: "test-api-key",
    EDGE_SERVICE_URL: "https://test.cyberworlds.com",
    PAGERDUTY_WEBHOOK_SECRET: "test-pagerduty-secret",
};

const originalEnv = process.env;

let mockFetchCalls: Array<{url: string; body: unknown}> = [];

const mockFetch = import.meta.jest.fn().mockImplementation((_url: string, options?: any) => {
    if (options?.body) {
        mockFetchCalls.push({
            url: _url,
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

function resetAlertSourceTestEnvironment(): void {
    process.env = {...originalEnv, ...mockEnv};
    mockFetchCalls = [];
    global.fetch = mockFetch;
    mockFetch.mockClear();
}

function restoreAlertSourceTestEnvironment(): void {
    process.env = originalEnv;
}

function formatFetchCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as {channelId: string; content: ApiContent};
    const markdown = printApiContentToMarkdown(body.content);
    return `URL: ${fetchCall.url}
Channel: ${body.channelId}

${markdown}`;
}

function createPagerDutySignature(body: string, webhookSecret = "test-pagerduty-secret"): string {
    const hmac = createHmac("sha256", webhookSecret);
    hmac.update(body);
    return `v1=${hmac.digest("hex")}`;
}

async function handlePagerDutyPayload(data: PagerDutyEventPayload): Promise<void> {
    await new PagerDutyAlertSource({body: "", headers: {}}).handlePayload(data);
}

describe("PagerDutyAlertSource", () => {
    beforeEach(() => {
        resetAlertSourceTestEnvironment();
    });

    afterEach(() => {
        restoreAlertSourceTestEnvironment();
    });

    const createPagerDutyFixture = (
        overrides: Partial<PagerDutyEventPayload> = {},
    ): PagerDutyEventPayload => ({
        event: {
            id: "pd-event-123",
            occurred_at: "2023-11-10T10:00:00Z",
            agent: {
                html_url: "https://api.pagerduty.com/agents/pagerduty",
                id: "pagerduty",
                self: "https://api.pagerduty.com/agents/pagerduty",
                summary: "PagerDuty",
                type: "user_reference",
            },
            client: {
                name: "PagerDuty Web",
            },
            event_type: "incident.triggered",
            resource_type: "incident",
            data: {
                id: "incident-123",
                type: "incident",
                self: "https://api.pagerduty.com/incidents/incident-123",
                html_url: "https://cyberworlds.pagerduty.com/incidents/incident-123",
                number: 42,
                status: "triggered",
                incident_key: "database-connection-error",
                created_at: "2023-11-10T10:00:00Z",
                reopened_at: null,
                title: "Database Connection Pool Exhausted",
                incident_type: {
                    name: "Database Error",
                },
                service: {
                    html_url: "https://cyberworlds.pagerduty.com/services/database-service",
                    id: "service-db-123",
                    self: "https://api.pagerduty.com/services/service-db-123",
                    summary: "Database Service",
                    type: "service_reference",
                },
                assignees: [
                    {
                        html_url: "https://cyberworlds.pagerduty.com/users/oncall-eng",
                        id: "user-oncall-eng",
                        self: "https://api.pagerduty.com/users/user-oncall-eng",
                        summary: "On-Call Engineer",
                        type: "user_reference",
                    },
                ],
                escalation_policy: {
                    html_url:
                        "https://cyberworlds.pagerduty.com/escalation_policies/eng-escalation",
                    id: "escalation-eng",
                    self: "https://api.pagerduty.com/escalation_policies/escalation-eng",
                    summary: "Engineering Escalation",
                    type: "escalation_policy_reference",
                },
                teams: [],
                priority: {
                    html_url: "https://cyberworlds.pagerduty.com/priorities/p1",
                    id: "priority-p1",
                    self: "https://api.pagerduty.com/priorities/priority-p1",
                    summary: "P1 - Critical",
                    type: "priority_reference",
                },
                urgency: "high",
                conference_bridge: {
                    conference_number: "+1-555-123-4567",
                    conference_url: "https://zoom.us/j/123456789",
                },
                resolve_reason: null,
            },
        },
        ...overrides,
    });

    describe("authorization", () => {
        test("returns an error when the webhook secret is not configured", () => {
            delete process.env.PAGERDUTY_WEBHOOK_SECRET;

            const authorization = new PagerDutyAlertSource({
                body: "{}",
                headers: {"x-pagerduty-signature": createPagerDutySignature("{}")},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 500,
                error: "PAGERDUTY_WEBHOOK_SECRET environment variable is not set",
            });
        });

        test("returns an error when no v1 signature is present", () => {
            const authorization = new PagerDutyAlertSource({
                body: "{}",
                headers: {"x-pagerduty-signature": "v2=signature"},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the signature is missing", () => {
            const authorization = new PagerDutyAlertSource({
                body: "{}",
                headers: {},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the body is missing", () => {
            const authorization = new PagerDutyAlertSource({
                headers: {"x-pagerduty-signature": createPagerDutySignature("{}")},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("returns an error when the signature length does not match", () => {
            const authorization = new PagerDutyAlertSource({
                body: "{}",
                headers: {"x-pagerduty-signature": "v1=short"},
            }).validateAuthorization();

            expect(authorization).toEqual({
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            });
        });

        test("validates a matching signature after an invalid signature", () => {
            const body = "{}";
            const authorization = new PagerDutyAlertSource({
                body,
                headers: {
                    "x-pagerduty-signature": `v1=${"0".repeat(64)}, ${createPagerDutySignature(body)}`,
                },
            }).validateAuthorization();

            expect(authorization).toEqual({ok: true});
        });
    });

    test("triggered incident", async () => {
        const payload = createPagerDutyFixture();

        await handlePagerDutyPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("acknowledged incident", async () => {
        const payload = createPagerDutyFixture({
            event: {
                ...createPagerDutyFixture().event,
                event_type: "incident.acknowledged",
                data: {
                    ...createPagerDutyFixture().event.data,
                },
            },
        });

        await handlePagerDutyPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("resolved incident", async () => {
        const payload = createPagerDutyFixture({
            event: {
                ...createPagerDutyFixture().event,
                event_type: "incident.resolved",
                data: {
                    ...createPagerDutyFixture().event.data,
                    // @ts-expect-error: Status does not exist on some types, just
                    // force it for this test
                    status: "resolved",
                    resolve_reason: "Database connection pool was restarted and issue resolved",
                },
            },
        });

        await handlePagerDutyPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });

    test("ignores non-incident event data", async () => {
        const payload = createPagerDutyFixture({
            event: {
                ...createPagerDutyFixture().event,
                event_type: "service.updated",
                resource_type: "service",
                data: {
                    html_url: "https://cyberworlds.pagerduty.com/services/database-service",
                    id: "service-db-123",
                    self: "https://api.pagerduty.com/services/service-db-123",
                    summary: "Database Service",
                    alert_creation: "create_alerts_and_incidents",
                    teams: [],
                    type: "service",
                },
            },
        });

        await handlePagerDutyPayload(payload);

        expect(mockFetchCalls).toHaveLength(0);
    });

    test("renders unknown incident status with missing optional fields", async () => {
        const payload = createPagerDutyFixture({
            event: {
                ...createPagerDutyFixture().event,
                event_type: "incident.escalated",
                data: {
                    ...createPagerDutyFixture().event.data,
                    // @ts-expect-error: Status only exists on incident data.
                    status: "escalated",
                    service: null,
                    priority: null,
                    incident_type: null,
                    assignees: [],
                },
            },
        });

        await handlePagerDutyPayload(payload);

        expect(mockFetchCalls).toHaveLength(1);
        expect(formatFetchCallForSnapshot(mockFetchCalls[0]!)).toMatchSnapshot();
    });
});
