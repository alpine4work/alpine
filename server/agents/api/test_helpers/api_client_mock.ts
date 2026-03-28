import jsonStableStringify from "json-stable-stringify";
import {PathsWithMethod} from "openapi-typescript-helpers";
import {ApiClient} from "~/server/agents/api/api_client.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type HttpMethod = "GET" | "PUT" | "POST" | "DELETE" | "PATCH";

// Configuration for a single mock response
type MockResponseConfig<
    Path extends keyof ApiSpecification.paths,
    Method extends Lowercase<HttpMethod>,
> = {
    params: ApiSpecification.paths[Path][Method] extends {parameters: infer Parameters}
        ? Parameters | "Any"
        : {} | "Any";
    data: ApiSpecification.paths[Path][Method] extends {
        responses: {200: {content: {"application/json": infer JsonResponse}}};
    }
        ? JsonResponse
        : null;
    response?: Partial<Response>;
};

// Matcher for request parameters
type RequestMatcher = {
    path: string;
    params: unknown;
    method: HttpMethod;
};

// Internal mock configuration
type MockConfig = {
    matcher: RequestMatcher;
    responses: Array<Omit<MockResponseConfig<any, any>, "params">>;
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
            try {
                this.assertAllMocksUsed();
            } finally {
                // Reset even if the above assert throws so we don't poison future tests with old
                // config.
                this.reset();
            }
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
        response: MockResponseConfig<Path, "get">,
    ) {
        this.addMock("GET", path, response);
    }

    /**
     * Configure a mock response for a PUT request
     */
    mockPut<Path extends PathsWithMethod<ApiSpecification.paths, "put">>(
        path: Path,
        response: MockResponseConfig<Path, "put">,
    ) {
        this.addMock("PUT", path, response);
    }

    /**
     * Configure a mock response for a POST request
     */
    mockPost<Path extends PathsWithMethod<ApiSpecification.paths, "post">>(
        path: Path,
        response: MockResponseConfig<Path, "post">,
    ) {
        this.addMock("POST", path, response);
    }

    /**
     * Configure a mock response for a DELETE request
     */
    mockDelete<Path extends PathsWithMethod<ApiSpecification.paths, "delete">>(
        path: Path,
        response: MockResponseConfig<Path, "delete">,
    ) {
        this.addMock("DELETE", path, response);
    }

    /**
     * Configure a mock response for a PATCH request
     */
    mockPatch<Path extends PathsWithMethod<ApiSpecification.paths, "patch">>(
        path: Path,
        response: MockResponseConfig<Path, "patch">,
    ) {
        this.addMock("PATCH", path, response);
    }

    /**
     * Register a path to spy on. Calls to this path will be recorded in request
     * history and auto-return {data: undefined} without needing an explicit mock.
     * Useful for endpoints like stream parts, pings, and completions.
     */
    spy(method: HttpMethod, path: string): void {
        this.spyConfigs.push({method, path});
    }

    private addMock(
        method: HttpMethod,
        path: string,
        {params, ...response}: MockResponseConfig<any, any>,
    ) {
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
        return await this.handleRequest("GET", tracer, url, options);
    };

    put: ApiClient["put"] = async (tracer, url, options) => {
        return await this.handleRequest("PUT", tracer, url, options);
    };

    post: ApiClient["post"] = async (tracer, url, options) => {
        return await this.handleRequest("POST", tracer, url, options);
    };

    delete: ApiClient["delete"] = async (tracer, url, options) => {
        return await this.handleRequest("DELETE", tracer, url, options);
    };

    patch: ApiClient["patch"] = async (tracer, url, options) => {
        return await this.handleRequest("PATCH", tracer, url, options);
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

        if (responseConfig?.error) {
            throw responseConfig.error;
        }

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
        params: unknown,
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
            //
            // We use `jsonStableStringify()` instead of `isDeepEqual()` to use JSON deep
            // equality semantics. For example ignoring `undefined` properties on objects.
            if (
                config.matcher.params !== "Any" &&
                jsonStableStringify(config.matcher.params) !== jsonStableStringify(params)
            ) {
                return false;
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
    getCallCount<Path extends PathsWithMethod<ApiSpecification.paths, "get">>(
        method: "GET",
        path: Path,
        params?: ApiSpecification.paths[Path]["get"] extends {
            parameters: infer Parameters;
        }
            ? Parameters | "Any"
            : {} | "Any",
    ): number;
    getCallCount<Path extends PathsWithMethod<ApiSpecification.paths, "put">>(
        method: "PUT",
        path: Path,
        params?: ApiSpecification.paths[Path]["put"] extends {
            parameters: infer Parameters;
        }
            ? Parameters | "Any"
            : {} | "Any",
    ): number;
    getCallCount<Path extends PathsWithMethod<ApiSpecification.paths, "post">>(
        method: "POST",
        path: Path,
        params?: ApiSpecification.paths[Path]["post"] extends {
            parameters: infer Parameters;
        }
            ? Parameters | "Any"
            : {} | "Any",
    ): number;
    getCallCount<Path extends PathsWithMethod<ApiSpecification.paths, "delete">>(
        method: "DELETE",
        path: Path,
        params?: ApiSpecification.paths[Path]["delete"] extends {
            parameters: infer Parameters;
        }
            ? Parameters | "Any"
            : {} | "Any",
    ): number;
    getCallCount<Path extends PathsWithMethod<ApiSpecification.paths, "patch">>(
        method: "PATCH",
        path: Path,
        params?: ApiSpecification.paths[Path]["patch"] extends {
            parameters: infer Parameters;
        }
            ? Parameters | "Any"
            : {} | "Any",
    ): number;
    getCallCount(method: HttpMethod, path: string, params: any = "Any"): number {
        return this.requestHistory.filter(record => {
            if (record.method !== method || record.path !== path) {
                return false;
            }
            if (params !== "Any") {
                return isDeepEqual(params, record.params);
            }
            return true;
        }).length;
    }
}
