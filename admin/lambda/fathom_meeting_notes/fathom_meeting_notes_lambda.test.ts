import type {APIGatewayProxyEventV2} from "aws-lambda";
import {createHmac} from "crypto";
import {handler} from "~/admin/lambda/fathom_meeting_notes/fathom_meeting_notes_lambda.js";
import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

type LambdaFunctionUrlResult = {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
};

type FetchCall = {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: unknown;
};

type MockResponse = {
    readonly status: number;
    readonly statusText: string;
    readonly body: unknown;
};

const originalEnv = process.env;
const fathomWebhookSecretBytes = new TextEncoder().encode("fathom-test-secret");
const fathomWebhookSecret = `whsec_${Buffer.from(fathomWebhookSecretBytes).toString("base64")}`;

let fetchCalls: Array<FetchCall> = [];
let mockResponses: Array<MockResponse> = [];

const mockFetch = import.meta.jest
    .fn()
    .mockImplementation(
        (
            url: string,
            options?: {method?: string; headers?: Record<string, string>; body?: string},
        ) => {
            fetchCalls.push({
                url,
                method: options?.method ?? "GET",
                headers: options?.headers ?? {},
                body: options?.body ? JSON.parse(options.body) : undefined,
            });
            const response = assertExists(mockResponses.shift());

            return Promise.resolve({
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.statusText,
                text: () =>
                    Promise.resolve(
                        response.body === undefined ? "" : JSON.stringify(response.body),
                    ),
            });
        },
    );

function createFathomPayload(overrides: Partial<FathomWebhookPayload> = {}): FathomWebhookPayload {
    return {
        title: "Tea Time",
        meeting_title: "Tea Time",
        meeting_type: "Internal Team Meeting",
        recording_id: 123456789,
        url: "https://fathom.video/calls/tea-time",
        meeting_url: "https://meet.google.com/tea-time",
        share_url: "https://fathom.video/share/tea-time",
        created_at: "2026-07-29T15:01:30Z",
        scheduled_start_time: "2026-07-29T14:00:00Z",
        scheduled_end_time: "2026-07-29T15:00:00Z",
        recording_start_time: "2026-07-29T14:01:00Z",
        recording_end_time: "2026-07-29T15:00:00Z",
        calendar_invitees_domains_type: "only_internal",
        shared_with: "all_teams",
        transcript_language: "en",
        transcript: [
            {
                speaker: {display_name: "Josh Johnson"},
                text: "The meeting notes webhook is ready.",
                timestamp: "00:02:00",
            },
        ],
        default_summary: {
            template_name: "general",
            markdown_formatted: "## Summary\n\nWe reviewed the meeting notes webhook.",
        },
        action_items: [],
        highlights: null,
        calendar_invitees: [
            {
                name: "Josh Johnson",
                email: "josh@alpine.inc",
                email_domain: "alpine.inc",
                is_external: false,
            },
        ],
        recorded_by: {
            name: "Josh Johnson",
            email: "josh@alpine.inc",
            email_domain: "alpine.inc",
            team: "Product",
        },
        crm_matches: null,
        ...overrides,
    };
}

function createParentResponse(
    elements: ReadonlyArray<Record<string, unknown>> = [
        {
            type: "Heading",
            key: "year",
            level: 2,
            elements: [{type: "Text", text: "2026"}],
        },
        {
            type: "Heading",
            key: "month",
            level: 3,
            elements: [{type: "Text", text: "July"}],
        },
    ],
) {
    return {
        spaceId: "test-space",
        document: {
            id: "ygfnxa6n51gcg07c3jx01vyqwc",
            creator: {id: "7dw297xezx6rs6qy4gjh6h5xx4"},
            version: 10,
            title: "Meeting Notes",
            content: {elements},
        },
    };
}

function createChildResponse(
    title: string,
    {
        documentId = "new-meeting-document",
        shareUrl,
    }: {readonly documentId?: string; readonly shareUrl?: string} = {},
) {
    return {
        spaceId: "test-space",
        document: {
            id: documentId,
            creator: {id: "7dw297xezx6rs6qy4gjh6h5xx4"},
            version: 0,
            title,
            content: {
                elements: shareUrl
                    ? [
                          {
                              type: "Paragraph",
                              elements: [
                                  {
                                      type: "Text",
                                      text: "VIEW RECORDING",
                                      marks: [{type: "Link", url: shareUrl}],
                                  },
                              ],
                          },
                      ]
                    : [],
            },
        },
    };
}

function createParentResponseWithMention(title: string, documentId: string) {
    return createParentResponse([
        {
            type: "Heading",
            key: "year",
            level: 2,
            elements: [{type: "Text", text: "2026"}],
        },
        {
            type: "Heading",
            key: "month",
            level: 3,
            elements: [{type: "Text", text: "July"}],
        },
        {
            type: "Paragraph",
            key: "mention",
            elements: [
                {
                    type: "Mention",
                    reference: {type: "Document", id: documentId, title},
                },
            ],
        },
    ]);
}

function createEvent(
    payload: FathomWebhookPayload,
    overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
    const body = JSON.stringify(payload);
    const webhookId = "msg_fathom_test";
    const webhookTimestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = createHmac("sha256", fathomWebhookSecretBytes)
        .update(`${webhookId}.${webhookTimestamp}.${body}`)
        .digest("base64");

    return {
        version: "2.0",
        routeKey: "$default",
        rawPath: "/",
        rawQueryString: "",
        headers: {
            "webhook-id": webhookId,
            "webhook-timestamp": webhookTimestamp,
            "webhook-signature": `v1,${signature}`,
        },
        requestContext: {
            accountId: "anonymous",
            apiId: "fathom-meeting-notes-test",
            domainName: "localhost",
            domainPrefix: "localhost",
            http: {
                method: "POST",
                path: "/",
                protocol: "HTTP/1.1",
                sourceIp: "127.0.0.1",
                userAgent: "jest",
            },
            requestId: webhookId,
            routeKey: "$default",
            stage: "$default",
            time: new Date().toISOString(),
            timeEpoch: Date.now(),
        },
        body,
        isBase64Encoded: false,
        ...overrides,
    };
}

async function callHandler(
    event: APIGatewayProxyEventV2,
): Promise<Omit<LambdaFunctionUrlResult, "body"> & {body: unknown}> {
    const result = (await handler(event, {} as any, () => undefined)) as LambdaFunctionUrlResult;
    return {...result, body: JSON.parse(result.body)};
}

describe("Fathom meeting notes Lambda", () => {
    beforeEach(() => {
        process.env = {
            ...originalEnv,
            ALPINE_API_KEY: "test-api-key",
            EDGE_SERVICE_URL: "https://test.cyberworlds.com",
            FATHOM_WEBHOOK_SECRET: fathomWebhookSecret,
        };
        fetchCalls = [];
        mockResponses = [];
        global.fetch = mockFetch;
        mockFetch.mockClear();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test("requires a request body", async () => {
        const result = await callHandler(createEvent(createFathomPayload(), {body: undefined}));

        expect(result).toMatchObject({
            statusCode: 400,
            body: {ok: false, error: "Request body is required"},
        });
    });

    test("requires the webhook secret", async () => {
        delete process.env.FATHOM_WEBHOOK_SECRET;

        const result = await callHandler(createEvent(createFathomPayload()));

        expect(result).toMatchObject({
            statusCode: 500,
            body: {
                ok: false,
                error: "FATHOM_WEBHOOK_SECRET environment variable is not set",
            },
        });
    });

    test("rejects a bad webhook signature", async () => {
        const event = createEvent(createFathomPayload());
        event.headers["webhook-signature"] = "v1,bad-signature";

        const result = await callHandler(event);

        expect(result).toMatchObject({
            statusCode: 401,
            body: {ok: false, error: "Invalid Fathom webhook signature"},
        });
    });

    test("creates notes and inserts them under the current month", async () => {
        const payload = createFathomPayload();
        const title = "Tea Time - July 29, 2026";
        mockResponses.push(
            {status: 200, statusText: "OK", body: createParentResponse()},
            {status: 200, statusText: "OK", body: createChildResponse(title)},
            {status: 200, statusText: "OK", body: createParentResponse()},
        );

        const result = await callHandler(createEvent(payload));
        const createBody = assertExists(fetchCalls[1]).body as {
            document: {
                title: string;
                content: {elements: Array<unknown>};
            };
        };

        expect(createBody.document).not.toHaveProperty("creator");

        expect({
            result,
            requests: fetchCalls.map(({url, method}) => ({url, method})),
            requestHeaders: fetchCalls[0]?.headers,
            createdDocument: {
                title: createBody.document.title,
                firstElement: createBody.document.content.elements[0],
            },
            parentUpdate: fetchCalls[2],
        }).toMatchObject({
            result: {
                statusCode: 200,
                body: {
                    ok: true,
                    message: "Meeting notes created",
                    documentId: "new-meeting-document",
                },
            },
            requests: [
                {
                    url: "https://api.test.cyberworlds.com/documents/ygfnxa6n51gcg07c3jx01vyqwc",
                    method: "GET",
                },
                {
                    url: "https://api.test.cyberworlds.com/documents",
                    method: "POST",
                },
                {
                    url: "https://api.test.cyberworlds.com/documents/ygfnxa6n51gcg07c3jx01vyqwc",
                    method: "PATCH",
                },
            ],
            requestHeaders: {
                "Alpine-Version": "2026-07-29",
                "Content-Type": "application/json",
                Authorization: "Bearer test-api-key",
            },
            createdDocument: {
                title,
                firstElement: {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Summary"}],
                },
            },
            parentUpdate: {
                body: {
                    patches: [
                        {
                            type: "SetContent",
                            version: 10,
                            content: {
                                elements: [
                                    {},
                                    {},
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {
                                                type: "Mention",
                                                reference: {
                                                    type: "Document",
                                                    id: "new-meeting-document",
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        });
    });

    test("adds a heading when a public meeting is in a new month", async () => {
        const payload = createFathomPayload({
            title: "Sprint Review: Customer planning",
            meeting_title: "Sprint Review: Customer planning",
            scheduled_start_time: "2026-08-06T15:00:00Z",
        });
        const title = "Sprint Review: Customer planning - August 6, 2026";
        mockResponses.push(
            {status: 200, statusText: "OK", body: createParentResponse()},
            {status: 200, statusText: "OK", body: createChildResponse(title)},
            {status: 200, statusText: "OK", body: createParentResponse()},
        );

        await callHandler(createEvent(payload));

        expect(fetchCalls[2]).toMatchObject({
            method: "PATCH",
            body: {
                patches: [
                    {
                        type: "SetContent",
                        content: {
                            elements: [
                                {},
                                {
                                    type: "Heading",
                                    level: 3,
                                    elements: [{type: "Text", text: "August"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Mention",
                                            reference: {
                                                type: "Document",
                                                id: "new-meeting-document",
                                            },
                                        },
                                    ],
                                },
                                {
                                    type: "Heading",
                                    level: 3,
                                    elements: [{type: "Text", text: "July"}],
                                },
                            ],
                        },
                    },
                ],
            },
        });
    });

    test("ignores non-public meetings without calling the Alpine API", async () => {
        const payload = createFathomPayload({
            title: "Customer planning",
            meeting_title: "Customer planning",
            share_url: "https://fathom.video/share/customer-planning",
        });

        const result = await callHandler(createEvent(payload));

        expect({result, fetchCalls}).toEqual({
            result: {
                statusCode: 200,
                headers: {"content-type": "application/json"},
                body: {
                    ok: true,
                    message: "Meeting notes skipped",
                },
            },
            fetchCalls: [],
        });
    });

    test("logs the transcript and summary for a public meeting", async () => {
        const payload = createFathomPayload();
        const title = "Tea Time - July 29, 2026";
        mockResponses.push(
            {status: 200, statusText: "OK", body: createParentResponse()},
            {status: 200, statusText: "OK", body: createChildResponse(title)},
            {status: 200, statusText: "OK", body: createParentResponse()},
        );
        const logSpy = import.meta.jest.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await callHandler(createEvent(payload));

            expect(
                logSpy.mock.calls.find(([message]) => message === "Creating public meeting notes"),
            ).toEqual([
                "Creating public meeting notes",
                {
                    transcript: payload.transcript,
                    summary: payload.default_summary?.markdown_formatted,
                },
            ]);
        } finally {
            logSpy.mockRestore();
        }
    });

    test("does not log the transcript or summary for a private meeting", async () => {
        const payload = createFathomPayload({
            title: "Customer planning",
            meeting_title: "Customer planning",
            share_url: "https://fathom.video/share/private-log-test",
            transcript: [
                {
                    speaker: {display_name: "Private speaker"},
                    text: "PRIVATE_TRANSCRIPT_CONTENT",
                    timestamp: "00:02:00",
                },
            ],
            default_summary: {
                template_name: "general",
                markdown_formatted: "PRIVATE_SUMMARY_CONTENT",
            },
        });
        const logSpy = import.meta.jest.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await callHandler(createEvent(payload));

            expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(
                /PRIVATE_TRANSCRIPT_CONTENT|PRIVATE_SUMMARY_CONTENT/u,
            );
        } finally {
            logSpy.mockRestore();
        }
    });

    test("does not create a duplicate for a completed delivery", async () => {
        const title = "Tea Time - July 29, 2026";
        mockResponses.push(
            {
                status: 200,
                statusText: "OK",
                body: createParentResponseWithMention(title, "existing-document"),
            },
            {
                status: 200,
                statusText: "OK",
                body: createChildResponse(title, {
                    documentId: "existing-document",
                    shareUrl: "https://fathom.video/share/tea-time",
                }),
            },
        );

        const result = await callHandler(createEvent(createFathomPayload()));

        expect({result, fetchCalls}).toMatchObject({
            result: {
                statusCode: 200,
                body: {
                    ok: true,
                    message: "Meeting notes already processed",
                    documentId: "existing-document",
                },
            },
            fetchCalls: [
                {method: "GET"},
                {
                    url: "https://api.test.cyberworlds.com/documents/existing-document",
                    method: "GET",
                },
            ],
        });
    });

    test("recognizes a completed delivery when Alpine truncates its mention title", async () => {
        const meetingTitle = `Tea Time ${"A".repeat(96)}`;
        const title = `${meetingTitle} - July 29, 2026`;
        const mentionTitle = `Tea Time ${"A".repeat(95)} […]`;
        mockResponses.push(
            {
                status: 200,
                statusText: "OK",
                body: createParentResponseWithMention(mentionTitle, "existing-document"),
            },
            {
                status: 200,
                statusText: "OK",
                body: createChildResponse(title, {
                    documentId: "existing-document",
                    shareUrl: "https://fathom.video/share/tea-time",
                }),
            },
        );

        const result = await callHandler(
            createEvent(createFathomPayload({title: meetingTitle, meeting_title: meetingTitle})),
        );

        expect({
            result,
            requests: fetchCalls.map(({method}) => method),
        }).toMatchObject({
            result: {
                statusCode: 200,
                body: {
                    message: "Meeting notes already processed",
                    documentId: "existing-document",
                },
            },
            requests: ["GET", "GET"],
        });
    });

    test("creates every meeting when two meetings have the same generated title", async () => {
        const title = "Tea Time - July 29, 2026";
        mockResponses.push(
            {
                status: 200,
                statusText: "OK",
                body: createParentResponseWithMention(title, "different-meeting"),
            },
            {
                status: 200,
                statusText: "OK",
                body: createChildResponse(title, {
                    documentId: "different-meeting",
                    shareUrl: "https://fathom.video/share/different-meeting",
                }),
            },
            {status: 200, statusText: "OK", body: createChildResponse(title)},
            {status: 200, statusText: "OK", body: createParentResponse()},
        );

        const result = await callHandler(createEvent(createFathomPayload()));

        expect({
            result,
            requests: fetchCalls.map(({method}) => method),
        }).toEqual({
            result: {
                statusCode: 200,
                headers: {"content-type": "application/json"},
                body: {
                    ok: true,
                    message: "Meeting notes created",
                    documentId: "new-meeting-document",
                },
            },
            requests: ["GET", "GET", "POST", "PATCH"],
        });
    });

    test("returns an Alpine API failure so Fathom can retry", async () => {
        mockResponses.push({
            status: 503,
            statusText: "Service Unavailable",
            body: {error: "unavailable"},
        });

        const result = await callHandler(createEvent(createFathomPayload()));

        expect(result).toMatchObject({
            statusCode: 503,
            body: {ok: false, error: "HTTP 503: Service Unavailable"},
        });
    });
});
