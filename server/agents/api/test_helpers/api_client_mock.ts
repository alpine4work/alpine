import {PathsWithMethod} from "openapi-typescript-helpers";
import {ApiClient} from "~/server/agents/api/api_client.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    ApiContentResponse,
    ApiDocumentCommentThreadResponse,
    ApiMessageResponse,
    ApiPostResponse,
    ApiTaskCollection,
    ApiTaskResponse,
    ApiTaskWithoutContent,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type HttpMethod = "GET" | "PUT" | "POST" | "DELETE" | "PATCH";

// Extract the success response data type for a given path and method
type SuccessResponseData<T> = T extends {responses: infer R}
    ? R extends {200: {content: {"application/json": infer Data}}}
        ? Data
        : R extends {201: {content: {"application/json": infer Data}}}
          ? Data
          : R extends {204: never}
            ? void
            : unknown
    : unknown;

// Configuration for a single mock response
type MockResponseConfig<TData = any> = {
    data: TData;
    response?: Partial<Response>;
};

// Matcher for request parameters
type RequestMatcher = {
    path: string;
    params?: any;
    method: HttpMethod;
};

// Internal mock configuration
type MockConfig = {
    matcher: RequestMatcher;
    responses: Array<MockResponseConfig>;
    callIndex: number;
};

// Record of a request that was made
type RequestRecord = {
    method: HttpMethod;
    path: string;
    params?: any;
    body?: any;
    tracer: TracerBase;
};

/**
 * If you provide a matcher, the mock will only return data if the request is an
 * exact match. If you don't provide a matcher, the mock will return data for the
 * requested path in the order in which you created the mock.
 */
// Spy configuration - auto-returns {data: undefined} for matching paths
type SpyConfig = {
    method: HttpMethod;
    path: string;
};

export class ApiClientMock implements ApiClient {
    private mockConfigs: Array<MockConfig> = [];
    private requestHistory: Array<RequestRecord> = [];
    private spyConfigs: Array<SpyConfig> = [];

    constructor() {
        afterEach(() => {
            this.assertAllMocksUsed();
            this.reset();
        });
    }

    /**
     * Configure a mock response for a GET request @param path - The API path (e.g.
     * "/chats/{id}/messages/{index}") @param responses - Array of responses to return
     * on successive calls @param params - Optional params to match (if provided, only
     * matches exact params)
     */
    mockGet<Path extends PathsWithMethod<ApiSpecification.paths, "get">>(
        path: Path,
        response: MockResponseConfig<SuccessResponseData<ApiSpecification.paths[Path]["get"]>>,
        params?: any,
    ) {
        this.addMock("GET", path, response, params);
    }

    /**
     * Configure a mock response for a PUT request
     */
    mockPut<Path extends PathsWithMethod<ApiSpecification.paths, "put">>(
        path: Path,
        response: MockResponseConfig<SuccessResponseData<ApiSpecification.paths[Path]["put"]>>,
        params?: any,
    ) {
        this.addMock("PUT", path, response, params);
    }

    /**
     * Configure a mock response for a POST request
     */
    mockPost<Path extends PathsWithMethod<ApiSpecification.paths, "post">>(
        path: Path,
        response: MockResponseConfig<SuccessResponseData<ApiSpecification.paths[Path]["post"]>>,
        params?: any,
    ) {
        this.addMock("POST", path, response, params);
    }

    /**
     * Configure a mock response for a DELETE request
     */
    mockDelete<Path extends PathsWithMethod<ApiSpecification.paths, "delete">>(
        path: Path,
        response: MockResponseConfig<SuccessResponseData<ApiSpecification.paths[Path]["delete"]>>,
        params?: any,
    ) {
        this.addMock("DELETE", path, response, params);
    }

    /**
     * Configure a mock response for a PATCH request
     */
    mockPatch<Path extends PathsWithMethod<ApiSpecification.paths, "patch">>(
        path: Path,
        response: MockResponseConfig<SuccessResponseData<ApiSpecification.paths[Path]["patch"]>>,
        params?: any,
    ) {
        this.addMock("PATCH", path, response, params);
    }

    /**
     * Register a path to spy on. Calls to this path will be recorded in request
     * history and auto-return {data: undefined} without needing an explicit mock.
     * Useful for endpoints like stream parts, pings, and completions.
     */
    spy(method: HttpMethod, path: string): void {
        this.spyConfigs.push({method, path});
    }

    private addMock(method: HttpMethod, path: string, response: MockResponseConfig, params?: any) {
        const mockConfig = this.findMatchingMock(method, path, params);
        if (mockConfig) {
            mockConfig.responses.push(response);
            return;
        }

        this.mockConfigs.push({
            matcher: {method, path, params},
            responses: [response],
            callIndex: 0,
        });
    }

    // Implement ApiClient interface
    get: ApiClient["get"] = async (tracer, url, options) => {
        return this.handleRequest("GET", tracer, url, options);
    };

    put: ApiClient["put"] = async (tracer, url, options) => {
        return this.handleRequest("PUT", tracer, url, options);
    };

    post: ApiClient["post"] = async (tracer, url, options) => {
        return this.handleRequest("POST", tracer, url, options);
    };

    delete: ApiClient["delete"] = async (tracer, url, options) => {
        return this.handleRequest("DELETE", tracer, url, options);
    };

    patch: ApiClient["patch"] = async (tracer, url, options) => {
        return this.handleRequest("PATCH", tracer, url, options);
    };

    private async handleRequest(
        method: HttpMethod,
        tracer: TracerBase,
        path: any,
        options: any,
    ): Promise<{data: any; response: Response}> {
        // Record this request
        this.requestHistory.push({
            method,
            path,
            params: options?.params,
            body: options?.body,
            tracer,
        });

        // Find matching mock configuration
        const mockConfig = this.findMatchingMock(method, path, options?.params);

        if (!mockConfig) {
            // Check if this path is being spied on
            const isSpy = this.spyConfigs.some(spy => spy.method === method && spy.path === path);
            if (isSpy) {
                // Auto-return {data: undefined} for spied paths
                return {
                    data: undefined,
                    response: new Response(null, {status: 200, statusText: "OK"}),
                };
            }

            throw new InvalidArgumentError(
                `No mock configured for \`${method} ${path}\`.\n` +
                    `Params: ${JSON.stringify(options?.params, null, 2)}\n` +
                    `Available mocks:\n${this.formatAvailableMocks()}`,
            );
        }

        // Check if we have more responses available
        if (mockConfig.callIndex >= mockConfig.responses.length) {
            throw new InvalidArgumentError(
                `Mock for \`${method} ${path}\` was called ${mockConfig.callIndex + 1} times ` +
                    `but only ${mockConfig.responses.length} response(s) were configured`,
            );
        }

        // Get the current response and increment call index
        const responseConfig = mockConfig.responses[mockConfig.callIndex];
        mockConfig.callIndex++;

        // Create a Response object with defaults
        const response = new Response(null, {
            status: 200,
            statusText: "OK",
            ...responseConfig?.response,
        });

        return {
            data: responseConfig?.data,
            response,
        };
    }

    private findMatchingMock(
        method: HttpMethod,
        path: string,
        params?: unknown,
    ): MockConfig | undefined {
        return this.mockConfigs.find(config => {
            // Method must match
            if (config.matcher.method !== method) {
                return false;
            }

            // Path must match
            if (config.matcher.path !== path) {
                return false;
            }

            // If matcher has params, they must match exactly
            if (config.matcher.params !== undefined) {
                return isDeepEqual(config.matcher.params, params);
            }

            // No params specified in matcher, so any params are acceptable
            return true;
        });
    }

    private formatAvailableMocks(): string {
        if (this.mockConfigs.length === 0) {
            return "  (none)";
        }

        return this.mockConfigs
            .map(config => {
                const paramsStr = config.matcher.params
                    ? ` with params ${JSON.stringify(config.matcher.params)}`
                    : "";
                return `  - ${config.matcher.method} ${config.matcher.path}${paramsStr} (${config.callIndex}/${config.responses.length} calls used)`;
            })
            .join("\n");
    }

    /**
     * Get all requests that were made to this mock
     */
    getRequestHistory(): ReadonlyArray<RequestRecord> {
        return [...this.requestHistory];
    }

    /**
     * Assert that all configured mocks were called the expected number of times
     */
    assertAllMocksUsed(): void {
        const unusedMocks = this.mockConfigs.filter(
            config => config.callIndex < config.responses.length,
        );

        if (unusedMocks.length > 0) {
            const messages = unusedMocks.map(
                config =>
                    `  - ${config.matcher.method} ${config.matcher.path}: ` +
                    `${config.callIndex}/${config.responses.length} calls used`,
            );

            throw new InvalidArgumentError(
                `Not all mocked responses were used:\n${messages.join("\n")}`,
            );
        }
    }

    /**
     * Reset all mocks and request history
     */
    reset(): void {
        this.mockConfigs = [];
        this.requestHistory = [];
        this.spyConfigs = [];
    }

    /**
     * Get the number of times a specific endpoint was called
     */
    getCallCount(method: HttpMethod, path: string, params?: any): number {
        return this.requestHistory.filter(record => {
            if (record.method !== method || record.path !== path) {
                return false;
            }
            if (params !== undefined) {
                return isDeepEqual(params, record.params);
            }
            return true;
        }).length;
    }

    mockGetChatMessagesList(
        spaceId: SpaceId,
        chatId: ChatId,
        responseData: {
            totalMessageCount?: number;
            nextCursor?: number | null;
            messages?: Array<ApiMessageResponse>;
        },
        // If you don't provide this, it'll match any page info in the order that you call
        // the mock.
        pageInfo?: {
            from?: "start" | "end";
            // undefined means the query is starting at the begining of the list of comments
            cursor: number | undefined;
            limit: number;
        },
    ): void {
        const matcherData = pageInfo
            ? {
                  path: {id: chatId},
                  query: {
                      ...(pageInfo.from ? {from: pageInfo.from} : {}),
                      cursor: pageInfo.cursor,
                      limit: pageInfo.limit,
                  },
              }
            : undefined;

        this.mockGet(
            "/chats/{id}/messages",
            {
                data: {
                    spaceId,
                    totalMessageCount: 0,
                    nextCursor: null,
                    messages: [],
                    ...responseData,
                },
            },
            matcherData,
        );
    }

    mockGetDocument(
        spaceId: SpaceId,
        documentId: DocumentId,
        responseData: Partial<{
            creatorId: AccountId;
            title: string;
            content: ApiContentResponse;
            version: number;
        }>,
    ): void {
        documentId ??= generateId<DocumentId>();
        spaceId ??= generateId<SpaceId>();
        const defaultContent: ApiContentResponse = {
            elements: [
                {type: "Paragraph", elements: [{type: "Text", text: "Test Document Content"}]},
            ],
        };

        this.mockGet(
            "/documents/{id}",
            {
                data: {
                    document: {
                        id: documentId,
                        title: responseData.title ?? "Test Document",
                        content: responseData.content ?? defaultContent,
                        version: responseData.version ?? 1,
                    },
                    spaceId,
                },
            },
            {path: {id: documentId}},
        );
    }

    mockGetDocumentThread(
        spaceId: SpaceId,
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        responseData: Partial<Omit<ApiDocumentCommentThreadResponse, "id">>,
    ): void {
        this.mockGet(
            "/documents/{id}/threads/{threadId}",
            {
                data: {
                    spaceId,
                    commentThread: {
                        id: commentThreadId,
                        createdTime: responseData.createdTime ?? serializeDateString(new Date()),
                        isResolved: responseData.isResolved ?? false,
                        commentCount: responseData.commentCount ?? 0,
                        documentContentSnippet: responseData.documentContentSnippet ?? {
                            elements: [],
                        },
                        firstCommentAuthor: responseData.firstCommentAuthor ?? null,
                    },
                },
            },
            {path: {id: documentId, threadId: commentThreadId}},
        );
    }

    mockGetDocumentCommentsList(
        spaceId: SpaceId,
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        responseData: {
            totalMessageCount?: number;
            nextCursor?: number | null;
            messages?: Array<ApiMessageResponse>;
        },
        pageInfo?: {
            from?: "start" | "end";
            // undefined means the query is starting at the begining of the list of comments
            cursor: number | undefined;
            limit: number;
        },
    ): void {
        const matcherData = pageInfo
            ? {
                  path: {id: documentId, threadId: commentThreadId},
                  query: {
                      ...(pageInfo.from ? {from: pageInfo.from} : {}),
                      cursor: pageInfo.cursor,
                      limit: pageInfo.limit,
                  },
              }
            : undefined;

        this.mockGet(
            "/documents/{id}/threads/{threadId}/messages",
            {
                data: {
                    spaceId,
                    totalMessageCount: 0,
                    nextCursor: null,
                    messages: [],
                    ...responseData,
                },
            },
            matcherData,
        );
    }

    mockGetPost(
        spaceId: SpaceId,
        postId: PostId,
        responseData: Partial<Omit<ApiPostResponse, "id">>,
    ): void {
        postId ??= generateId<PostId>();
        spaceId ??= generateId<SpaceId>();
        const defaultContent: ApiContentResponse = {
            elements: [{type: "Paragraph", elements: [{type: "Text", text: "Test Post Content"}]}],
        };

        this.mockGet(
            "/posts/{id}",
            {
                data: {
                    post: {
                        id: postId,
                        author: responseData.author ?? createApiAccountMock({}),
                        createdTimeZone: responseData.createdTimeZone ?? defaultTimeZone,
                        content: responseData.content ?? defaultContent,
                        contentPreview: responseData.contentPreview ?? "Test Post Content Preview",
                        createdTime: responseData.createdTime ?? serializeDateString(new Date()),
                        ...responseData,
                    },
                    spaceId,
                },
            },
            {path: {id: postId}},
        );
    }

    mockGetPostCommentsList(
        spaceId: SpaceId,
        postId: PostId,
        responseData: {
            totalMessageCount?: number;
            nextCursor?: number | null;
            messages?: Array<ApiMessageResponse>;
        },
        // If you don't provide this, it'll match any page info in the order that you call
        // the mock.
        pageInfo?: {
            from?: "start" | "end";
            // undefined means the query is starting at the begining of the list of comments
            cursor: number | undefined;
            limit: number;
        },
    ): void {
        const matcherData = pageInfo
            ? {
                  path: {id: postId},
                  query: {
                      ...(pageInfo.from ? {from: pageInfo.from} : {}),
                      cursor: pageInfo.cursor,
                      limit: pageInfo.limit,
                  },
              }
            : undefined;

        this.mockGet(
            "/posts/{id}/messages",
            {
                data: {
                    spaceId,
                    totalMessageCount: 0,
                    nextCursor: null,
                    messages: [],
                    ...responseData,
                },
            },
            matcherData,
        );
    }

    mockGetTask(
        spaceId: SpaceId,
        taskId: TaskId,
        responseData: Partial<Omit<ApiTaskResponse, "id">>,
    ): void {
        taskId ??= generateId<TaskId>();
        spaceId ??= generateId<SpaceId>();

        this.mockGet(
            "/tasks/{id}",
            {
                data: {
                    task: {
                        id: taskId,
                        status: responseData.status ?? {type: "Open", isActive: true},
                        title: responseData.title ?? "Test Task",
                        content: responseData.content ?? {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Test Task Content"}],
                                },
                            ],
                        },
                        ...responseData,
                    },
                    spaceId,
                },
            },
            {path: {id: taskId}},
        );
    }

    mockGetTaskCommentsList(
        spaceId: SpaceId,
        taskId: TaskId,
        responseData: {
            totalMessageCount?: number;
            nextCursor?: number | null;
            messages?: Array<ApiMessageResponse>;
        },
        pageInfo?: {
            from?: "start" | "end";
            // undefined means the query is starting at the begining of the list of comments
            cursor: number | undefined;
            limit: number;
        },
    ): void {
        const matcherData = pageInfo
            ? {
                  path: {id: taskId},
                  query: {
                      ...(pageInfo.from ? {from: pageInfo.from} : {}),
                      cursor: pageInfo.cursor,
                      limit: pageInfo.limit,
                  },
              }
            : undefined;

        this.mockGet(
            "/tasks/{id}/messages",
            {
                data: {
                    spaceId,
                    totalMessageCount: 0,
                    nextCursor: null,
                    messages: [],
                    ...responseData,
                },
            },
            matcherData,
        );
    }

    mockGetTaskCollection(
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        responseData: Partial<Omit<ApiTaskCollection, "id">>,
    ): void {
        this.mockGet(
            "/task-collections/{id}",
            {
                data: {
                    spaceId,
                    taskCollection: {
                        id: collectionId,
                        name: responseData.name ?? "Test Task Collection",
                    },
                },
            },
            {path: {id: collectionId}},
        );
    }

    mockGetTaskCollectionTasks(
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        responseData: {
            totalTaskCount?: number;
            nextCursor?: string | null;
            tasks?: Array<ApiTaskWithoutContent>;
        },
        queryParams?: {
            limit?: number;
            cursor?: string | null;
            status?: Array<"Open" | "Closed">;
        },
    ): void {
        const matcherData = queryParams
            ? {
                  path: {id: collectionId},
                  query: queryParams,
              }
            : undefined;

        this.mockGet(
            "/task-collections/{id}/tasks",
            {
                data: {
                    spaceId,
                    nextCursor: responseData.nextCursor ?? null,
                    tasks: responseData.tasks ?? [],
                },
            },
            matcherData,
        );
    }
}
