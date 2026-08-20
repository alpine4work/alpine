import {HoneycombAlertSource} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source.js";
import {
    HoneycombEventAlertPayload,
    HoneycombEventPayload,
    HoneycombEventPayloadBase,
    HoneycombTaskPayload,
    HoneycombTriggerPayload,
} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source_types.js";
import {sendAlertAvailableTaskCollections} from "~/admin/lambda/send_alert/internal/send_alert_available_task_collections.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {ApiContentRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import type {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";

const mockEnv = {
    ALPINE_API_KEY: "test-api-key",
    EDGE_SERVICE_URL: "https://test.cyberworlds.com",
    HONEYCOMB_WEBHOOK_SECRET: "test-honeycomb-secret",
};

const originalEnv = process.env;

let mockHoneycombApiCalls: Array<string> = [];

let mockFetchCalls: Array<{url: string; method: string; body: unknown}> = [];

let mockFetchResponses: Array<{
    url: string;
    method: string;
    body: unknown;
    ok?: boolean;
    status?: number;
    statusText?: string;
}> = [];

type HoneycombChannelPayload = HoneycombEventAlertPayload | HoneycombTriggerPayload;

type HoneycombChannelFixtureOverrides = Partial<HoneycombChannelPayload> & {
    type?: "event" | "trigger";
};

type HoneycombTaskFixtureOverrides = Partial<HoneycombTaskPayload> &
    Pick<HoneycombTaskPayload, "collection" | "type">;

type ApiCreateTaskRequestBody =
    ApiSpecification.paths["/tasks"]["post"]["requestBody"]["content"]["application/json"];
type ApiCreatePostRequestBody =
    ApiSpecification.paths["/posts"]["post"]["requestBody"]["content"]["application/json"];

const mockFetch = import.meta.jest.fn().mockImplementation((url: string, options?: any) => {
    const method = options?.method ?? "GET";

    if (url.startsWith("https://api.honeycomb.io/")) {
        mockHoneycombApiCalls.push(url);
    }

    if (!(method === "GET" && url.includes("/channels/"))) {
        mockFetchCalls.push({
            url,
            method,
            body: options?.body ? JSON.parse(options.body) : null,
        });
    }

    const responseIndex = mockFetchResponses.findIndex(
        response => response.url === url && response.method === method,
    );
    const responseEntry =
        responseIndex === -1 ? undefined : mockFetchResponses.splice(responseIndex, 1)[0]!;

    const defaultResponseBody =
        responseEntry === undefined && method === "GET" && url.includes("/channels/")
            ? {
                  spaceId: "test-space-id",
                  channel: {
                      id: url.split("/").at(-1),
                      name: "Alert Channel",
                      description: {elements: []},
                  },
              }
            : {};

    return Promise.resolve({
        ok: responseEntry?.ok ?? true,
        status: responseEntry?.status ?? 200,
        statusText: responseEntry?.statusText ?? "OK",
        text: () =>
            Promise.resolve(
                responseEntry === undefined
                    ? JSON.stringify(defaultResponseBody)
                    : JSON.stringify(responseEntry.body),
            ),
    });
});

function resetAlertSourceTestEnvironment(): void {
    process.env = {...originalEnv, ...mockEnv};
    mockFetchCalls = [];
    mockFetchResponses = [];
    mockHoneycombApiCalls = [];
    sendAlertAvailableTaskCollections.honeycomb = "" as TaskCollectionId;
    global.fetch = mockFetch;
    mockFetch.mockClear();
}

function restoreAlertSourceTestEnvironment(): void {
    import.meta.jest.useRealTimers();
    process.env = originalEnv;
}

function formatFetchCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as ApiCreatePostRequestBody;
    const markdown = printApiContentToMarkdown(body.post.content);
    return `URL: ${fetchCall.url}
Channel: ${body.post.channel.id}

${markdown}`;
}

function formatCreateTaskCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as ApiCreateTaskRequestBody;
    assert(body.task.notes, "Expected create task request body to include task notes");
    const markdown = printApiContentToMarkdown(body.task.notes.content);
    return `URL: ${fetchCall.url}
Title: ${body.task.title}
Priority: ${body.task.priority?.type ?? ""}

${markdown}`;
}

function formatCreateTaskMessageCallForSnapshot(fetchCall: {url: string; body: unknown}): string {
    const body = fetchCall.body as {content: ApiContentRequest};
    const markdown = printApiContentToMarkdown(body.content);
    return `URL: ${fetchCall.url}

${markdown}`;
}

function queueAlpineApiResponse(
    method: string,
    path: string,
    body: unknown,
    options: {ok?: boolean; status?: number; statusText?: string} = {},
): void {
    mockFetchResponses.push({
        url: `https://api.test.cyberworlds.com${path}`,
        method,
        body,
        ...options,
    });
}

function getFetchCallPath(fetchCall: {url: string}): string {
    const url = new URL(fetchCall.url);
    return `${url.pathname}${url.search}`;
}

function createTaskMessage(index: number, text: string) {
    return {
        index,
        author: {id: "account-1", name: "Alert Bot"},
        createdTime: "2026-06-09T12:34:56.000Z",
        createdTimeZone: "UTC",
        payload: {
            type: "Content",
            content: {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text}],
                    },
                ],
            },
            files: [],
        },
    };
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

    function createHoneycombFixture(overrides: HoneycombTaskFixtureOverrides): HoneycombTaskPayload;
    function createHoneycombFixture(
        overrides?: HoneycombChannelFixtureOverrides,
    ): HoneycombChannelPayload;
    function createHoneycombFixture(
        overrides: HoneycombChannelFixtureOverrides | HoneycombTaskFixtureOverrides = {},
    ): HoneycombEventPayload {
        const basePayload: HoneycombEventPayloadBase = {
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
        };

        if (overrides.type === "task") {
            return {
                ...basePayload,
                ...overrides,
            };
        }

        return {
            ...basePayload,
            ...overrides,
        };
    }

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

    test("posts to alerts when the Alpine API rejects an alert", async () => {
        const payload = createHoneycombFixture({
            groupsTriggered: [
                {
                    group: [{key: "exception.message", value: "Connection refused"}],
                    result: 1,
                },
            ],
        });
        queueAlpineApiResponse(
            "POST",
            "/posts",
            {
                error: {
                    message: "Invalid request body (path: `#/content/elements/3`).",
                    retry: {able: false},
                },
            },
            {ok: false, status: 400, statusText: "Bad Request"},
        );

        const result = await new HoneycombAlertSource({
            body: JSON.stringify(payload),
            headers: {
                "content-type": "application/json",
                "x-honeycomb-webhook-token": "test-honeycomb-secret",
            },
            httpMethod: "POST",
            requestContext: {
                http: {
                    method: "POST",
                    path: "/send-alert",
                    sourceIp: "127.0.0.1",
                },
            },
        }).handlePayload(payload);

        expect(result).toMatchObject({
            ok: false,
            error: "HTTP 400: Bad Request",
            statusCode: 400,
        });
        expect(mockFetchCalls).toHaveLength(2);
        expect(formatFetchCallForSnapshot(mockFetchCalls[1]!)).toMatchSnapshot();
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
            type: "event",
            isEvent: undefined,
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

    test("ignores resolved task alert", async () => {
        const payload = createHoneycombFixture({
            type: "task",
            channel: "honeycomb",
            collection: "honeycomb",
            alert: {
                instanceId: "task-instance-ok",
                description: "Resolved task alert",
                status: "OK",
                summary: "Task alert returned to normal",
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

    test("creates a task for each Honeycomb task payload row", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        const taskTitles = [
            "[/settings] AssertionError: Root cause title",
            "RouteError: Route exploded",
            "[/api] TimeoutError",
            "api Timeout",
        ];
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [],
            },
        );
        taskTitles.forEach((title, index) => {
            const taskId = `task-${index + 1}`;
            queueAlpineApiResponse("POST", "/tasks", {
                spaceId,
                task: {
                    id: taskId,
                    status: {type: "Open", isActive: false},
                    title,
                    content: {elements: []},
                },
            });
            queueAlpineApiResponse("PATCH", `/tasks/${taskId}`, {
                spaceId,
                task: {
                    id: taskId,
                    status: {type: "Open", isActive: false},
                    title,
                    content: {elements: []},
                },
            });
        });

        const payload = createHoneycombFixture({
            type: "task",
            channel: undefined,
            collection: "honeycomb",
            groupsTriggered: [
                {
                    group: [
                        {key: "context.route", value: "/settings"},
                        {key: "exception.cause.type", value: "AssertionError"},
                        {key: "exception.cause.message", value: "Root cause title"},
                        {key: "exception.message", value: "Outer error"},
                    ],
                    result: 2,
                },
                {
                    group: [
                        {key: "exception.type", value: "RouteError"},
                        {key: "exception.message", value: "Route exploded"},
                    ],
                    result: 1,
                },
                {
                    group: [
                        {key: "context.route", value: "/api"},
                        {key: "exception.type", value: "TimeoutError"},
                    ],
                    result: 3,
                },
                {
                    group: [
                        {key: "service.name", value: "api"},
                        {key: "error.type", value: "Timeout"},
                        {key: "count", value: "100"},
                    ],
                    result: 4,
                },
            ],
        });

        await handleHoneycombPayload(payload);

        expect(mockFetchCalls.map(call => `${call.method} ${getFetchCallPath(call)}`)).toEqual([
            `GET /task-collections/${taskCollectionId}`,
            `GET /task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            "POST /tasks",
            "PATCH /tasks/task-1",
            "POST /tasks",
            "PATCH /tasks/task-2",
            "POST /tasks",
            "PATCH /tasks/task-3",
            "POST /tasks",
            "PATCH /tasks/task-4",
        ]);
        const createTaskCalls = mockFetchCalls.filter(
            call => call.method === "POST" && getFetchCallPath(call) === "/tasks",
        );
        expect(
            createTaskCalls.map(call => (call.body as ApiCreateTaskRequestBody).task.title),
        ).toEqual(taskTitles);
        expect(createTaskCalls.map(formatCreateTaskCallForSnapshot)).toMatchSnapshot();
    });

    test("starts Honeycomb task payload rows at the requested priority", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [],
            },
        );
        queueAlpineApiResponse("POST", "/tasks", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });
        queueAlpineApiResponse("PATCH", "/tasks/task-1", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: undefined,
                collection: "honeycomb",
                priority: "hIgH",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 1,
                    },
                ],
            }),
        );

        const createTaskCall = mockFetchCalls.find(
            call => call.method === "POST" && getFetchCallPath(call) === "/tasks",
        );
        expect(formatCreateTaskCallForSnapshot(createTaskCall!)).toMatchSnapshot();
    });

    test("comments on an open task when a Honeycomb task title already exists", async () => {
        import.meta.jest.useFakeTimers().setSystemTime(new Date("2026-06-09T12:34:56.000Z"));

        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 1,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 1,
            nextCursor: null,
            messages: [createTaskMessage(0, "This happened again 7 times")],
        });

        const payload = createHoneycombFixture({
            type: "task",
            channel: undefined,
            collection: "honeycomb",
            groupsTriggered: [
                {
                    group: [{key: "exception.cause.message", value: "Root cause title"}],
                    result: 7,
                },
            ],
        });

        await handleHoneycombPayload(payload);

        expect(
            mockFetchCalls.some(
                call => call.method === "POST" && getFetchCallPath(call) === "/tasks",
            ),
        ).toBe(false);
        const commentCall = mockFetchCalls.find(
            call =>
                call.method === "POST" &&
                getFetchCallPath(call) === "/tasks/existing-task/messages",
        );
        expect(formatCreateTaskMessageCallForSnapshot(commentCall!)).toMatchSnapshot();
    });

    test("bumps priority every fifth Honeycomb task occurrence comment", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                            priority: {type: "Low"},
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 4,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 6,
            nextCursor: null,
            messages: [
                createTaskMessage(0, "This happened again 1 time"),
                createTaskMessage(1, "This happened again 2 times"),
                createTaskMessage(2, "Not a Honeycomb recurrence"),
                createTaskMessage(3, "This happened again 3 times"),
                createTaskMessage(4, "This happened again 4 times"),
                createTaskMessage(5, "This happened again 5 times"),
            ],
        });
        queueAlpineApiResponse("PATCH", "/tasks/existing-task", {
            spaceId,
            task: {
                id: "existing-task",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "Medium"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: undefined,
                collection: "honeycomb",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 5,
                    },
                ],
            }),
        );

        const priorityCall = mockFetchCalls.find(
            call => call.method === "PATCH" && getFetchCallPath(call) === "/tasks/existing-task",
        );
        expect(priorityCall?.body).toEqual({
            patches: [{type: "SetPriority", priority: {type: "Medium"}}],
        });
    });

    test("sets an existing task to a higher payload priority", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                            priority: {type: "Low"},
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 2,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 2,
            nextCursor: null,
            messages: [
                createTaskMessage(0, "This happened again 1 time"),
                createTaskMessage(1, "This happened again 2 times"),
            ],
        });
        queueAlpineApiResponse("PATCH", "/tasks/existing-task", {
            spaceId,
            task: {
                id: "existing-task",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: undefined,
                collection: "honeycomb",
                priority: "high",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 3,
                    },
                ],
            }),
        );

        const priorityCall = mockFetchCalls.find(
            call => call.method === "PATCH" && getFetchCallPath(call) === "/tasks/existing-task",
        );
        expect(priorityCall?.body).toEqual({
            patches: [{type: "SetPriority", priority: {type: "High"}}],
        });
    });

    test("posts a task preview when bumping priority for a task channel", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                            priority: {type: "Medium"},
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 4,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 5,
            nextCursor: null,
            messages: [
                createTaskMessage(0, "This happened again 1 time"),
                createTaskMessage(1, "This happened again 2 times"),
                createTaskMessage(2, "This happened again 3 times"),
                createTaskMessage(3, "This happened again 4 times"),
                createTaskMessage(4, "This happened again 5 times"),
            ],
        });
        queueAlpineApiResponse("PATCH", "/tasks/existing-task", {
            spaceId,
            task: {
                id: "existing-task",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: "honeycomb",
                collection: "honeycomb",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 5,
                    },
                ],
            }),
        );

        const postCall = mockFetchCalls.find(
            call => call.method === "POST" && getFetchCallPath(call) === "/posts",
        );
        expect(formatFetchCallForSnapshot(postCall!)).toMatchSnapshot();
    });

    test("posts an alert task preview when payload priority skips medium", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                            priority: {type: "Low"},
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 4,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 5,
            nextCursor: null,
            messages: [
                createTaskMessage(0, "This happened again 1 time"),
                createTaskMessage(1, "This happened again 2 times"),
                createTaskMessage(2, "This happened again 3 times"),
                createTaskMessage(3, "This happened again 4 times"),
                createTaskMessage(4, "This happened again 5 times"),
            ],
        });
        queueAlpineApiResponse("PATCH", "/tasks/existing-task", {
            spaceId,
            task: {
                id: "existing-task",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: "honeycomb",
                collection: "honeycomb",
                priority: "high",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 5,
                    },
                ],
            }),
        );

        const postCall = mockFetchCalls.find(
            call => call.method === "POST" && getFetchCallPath(call) === "/posts",
        );
        expect(formatFetchCallForSnapshot(postCall!)).toMatchSnapshot();
    });

    test("posts a warning task preview when bumping priority to medium", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [
                    {
                        cursor: "task-cursor",
                        task: {
                            id: "existing-task",
                            status: {type: "Open", isActive: false},
                            title: "Root cause title",
                            priority: {type: "Low"},
                        },
                    },
                ],
            },
        );
        queueAlpineApiResponse("POST", "/tasks/existing-task/messages", {
            spaceId,
            message: {
                index: 4,
                author: {id: "account-1", name: "Alert Bot"},
                createdTime: "2026-06-09T12:34:56.000Z",
                createdTimeZone: "UTC",
                content: {elements: []},
                contentPreview: "",
            },
        });
        queueAlpineApiResponse("GET", "/tasks/existing-task/messages?limit=100", {
            spaceId,
            totalMessageCount: 5,
            nextCursor: null,
            messages: [
                createTaskMessage(0, "This happened again 1 time"),
                createTaskMessage(1, "This happened again 2 times"),
                createTaskMessage(2, "This happened again 3 times"),
                createTaskMessage(3, "This happened again 4 times"),
                createTaskMessage(4, "This happened again 5 times"),
            ],
        });
        queueAlpineApiResponse("PATCH", "/tasks/existing-task", {
            spaceId,
            task: {
                id: "existing-task",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "Medium"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: "honeycomb",
                collection: "honeycomb",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 5,
                    },
                ],
            }),
        );

        const postCall = mockFetchCalls.find(
            call => call.method === "POST" && getFetchCallPath(call) === "/posts",
        );
        expect(formatFetchCallForSnapshot(postCall!)).toMatchSnapshot();
    });

    test("truncates Honeycomb task titles to the task title limit", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [],
            },
        );
        queueAlpineApiResponse("POST", "/tasks", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "unused",
                content: {elements: []},
            },
        });
        queueAlpineApiResponse("PATCH", "/tasks/task-1", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "unused",
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: undefined,
                collection: "honeycomb",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "x".repeat(600)}],
                        result: 1,
                    },
                ],
            }),
        );

        const createTaskCall = mockFetchCalls.find(
            call => call.method === "POST" && getFetchCallPath(call) === "/tasks",
        );
        const title = (createTaskCall!.body as any).task.title as string;
        expect({length: title.length, ending: title.slice(-3)}).toEqual({
            length: 512,
            ending: "...",
        });
    });

    test("posts a warning task preview when payload priority is medium", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [],
            },
        );
        queueAlpineApiResponse("POST", "/tasks", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "Medium"},
                content: {elements: []},
            },
        });
        queueAlpineApiResponse("PATCH", "/tasks/task-1", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "Medium"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: "honeycomb",
                collection: "honeycomb",
                priority: "medium",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 1,
                    },
                ],
            }),
        );

        expect(mockFetchCalls.map(call => `${call.method} ${getFetchCallPath(call)}`)).toEqual([
            `GET /task-collections/${taskCollectionId}`,
            `GET /task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            "POST /tasks",
            "PATCH /tasks/task-1",
            "POST /posts",
        ]);
        const previewCall = mockFetchCalls.at(-1)!;
        expect(formatFetchCallForSnapshot(previewCall)).toMatchSnapshot();
    });

    test("posts an alert task preview when payload priority is high", async () => {
        const taskCollectionId = "task-collection-123" as TaskCollectionId;
        const spaceId = "space-123";
        sendAlertAvailableTaskCollections.honeycomb = taskCollectionId;
        queueAlpineApiResponse("GET", `/task-collections/${taskCollectionId}`, {
            spaceId,
            collection: {id: taskCollectionId, name: "Honeycomb"},
        });
        queueAlpineApiResponse(
            "GET",
            `/task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            {
                spaceId,
                nextCursor: null,
                tasks: [],
            },
        );
        queueAlpineApiResponse("POST", "/tasks", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });
        queueAlpineApiResponse("PATCH", "/tasks/task-1", {
            spaceId,
            task: {
                id: "task-1",
                status: {type: "Open", isActive: false},
                title: "Root cause title",
                priority: {type: "High"},
                content: {elements: []},
            },
        });

        await handleHoneycombPayload(
            createHoneycombFixture({
                type: "task",
                channel: "honeycomb",
                collection: "honeycomb",
                priority: "high",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 1,
                    },
                ],
            }),
        );

        expect(mockFetchCalls.map(call => `${call.method} ${getFetchCallPath(call)}`)).toEqual([
            `GET /task-collections/${taskCollectionId}`,
            `GET /task-collections/${taskCollectionId}/tasks?limit=100&status=Open`,
            "POST /tasks",
            "PATCH /tasks/task-1",
            "POST /posts",
        ]);
        const previewCall = mockFetchCalls.at(-1)!;
        expect(formatFetchCallForSnapshot(previewCall)).toMatchSnapshot();
    });

    test("rejects an unsupported task preview channel before calling the API", async () => {
        const result = await new HoneycombAlertSource({body: "", headers: {}}).handlePayload(
            createHoneycombFixture({
                type: "task",
                channel: "hneycomb",
                collection: "honeycomb",
                groupsTriggered: [
                    {
                        group: [{key: "exception.cause.message", value: "Root cause title"}],
                        result: 1,
                    },
                ],
            }),
        );

        expect({result, calls: mockFetchCalls}).toEqual({
            result: {
                ok: false,
                statusCode: 400,
                error: "Unknown Honeycomb task preview channel: hneycomb",
            },
            calls: [],
        });
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
