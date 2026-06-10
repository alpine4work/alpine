import {request} from "@octokit/request";
import type {
    EndpointOptions,
    Endpoints,
    OctokitResponse,
    RequestInterface,
    RequestParameters,
    RequestRequestOptions,
} from "@octokit/types";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {convertSnakeCaseToCamelCase} from "~/shared/helpers/string/convert_snake_case_to_camel_case.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {getHeadersTracerData} from "~/shared/tracer/fetch_with_tracer.js";

export type GithubContextModuleAuth = (
    request: RequestInterface,
    options: EndpointOptions,
) => Promise<OctokitResponse<any>>;

/**
 * Context module for accessing the GitHub API. Authorizes and traces any requests
 * to the GitHub API.
 */
export abstract class GithubContextModuleBase extends ContextModuleBase<{
    tracer: TracerContextModule;
}> {
    /**
     * Make a request against the GitHub API using the same interface as
     * [`@octokit/request`][1]. This method is:
     *
     * - Type checked using [`@octokit/types`][2]
     * - Properly authenticated based on how the context module is constructed
     * - Traced so all requests show up in our logs
     *
     * [1]: https://github.com/octokit/request.js
     * [2]: https://github.com/octokit/types.ts
     */
    public abstract request<R extends keyof Endpoints>(
        githubRouteAndMethod: R,
        options?: Endpoints[R]["parameters"] & RequestParameters,
    ): Promise<Endpoints[R]["response"]>;

    /**
     * Same as `request()` but we don't create a span. Avoid using this! We ideally
     * want to trace all network requests from our services.
     */
    public abstract quietlyRequestWithoutTracing<R extends keyof Endpoints>(
        githubRouteAndMethod: R,
        options?: Endpoints[R]["parameters"] & RequestParameters,
    ): Promise<Endpoints[R]["response"]>;
}

export class GithubContextModule extends GithubContextModuleBase {
    private readonly _auth: GithubContextModuleAuth;

    constructor(auth: GithubContextModuleAuth) {
        super();
        this._auth = auth;
    }

    /**
     * Make a request against the GitHub API using the same interface as
     * [`@octokit/request`][1]. This method is:
     *
     * - Type checked using [`@octokit/types`][2]
     * - Properly authenticated based on how the context module is constructed
     * - Traced so all requests show up in our logs
     *
     * [1]: https://github.com/octokit/request.js
     * [2]: https://github.com/octokit/types.ts
     */
    public override request<R extends keyof Endpoints>(
        githubRouteAndMethod: R,
        options?: Endpoints[R]["parameters"] & RequestParameters,
    ): Promise<Endpoints[R]["response"]> {
        const [method, githubRoute] = githubRouteAndMethod.split(" ", 2);
        assert(method !== undefined && githubRoute !== undefined);

        const route = formatGithubRoute(githubRoute);

        return this._context.tracer.withSpan(`GitHub ${method} ${route}`, (context, span) => {
            const requestOptions: RequestRequestOptions = {
                // Authorize the request to the GitHub API.
                hook: this._auth,

                // Add the same tracer data as `fetchWithTracer()` to requests made against the
                // GitHub API. Requests to GitHub are made with `@octokit/request` for proper
                // parsing.
                fetch: async (url: string, init?: RequestInit) => {
                    const requestUrl = new URL(url);
                    const request = new Request(url, init);

                    span.addData({
                        net: {
                            sock: {
                                peer: {
                                    name:
                                        typeof requestUrl !== "string"
                                            ? requestUrl.hostname
                                            : undefined,
                                    port:
                                        typeof requestUrl !== "string" && requestUrl.port.length > 0
                                            ? requestUrl.port
                                            : undefined,
                                },
                            },
                        },
                        http: {
                            service: {name: "GitHub"},
                            route,
                            url: requestUrl.toString(),
                            method: init?.method ?? "GET",
                            userAgent: request.headers.get("user-agent") ?? undefined,
                            request: {
                                header: getHeadersTracerData(request.headers),
                            },
                        },
                    });

                    const fetchStartTime = span.clock.now();

                    // eslint-disable-next-line cyberworlds/no-global-fetch
                    const response = await fetch(request);

                    const fetchEndTime = span.clock.now();

                    span.addData({
                        http: {
                            fetchDurationMs: fetchEndTime - fetchStartTime,
                            statusCode: response.status,
                            response: {
                                header: getHeadersTracerData(response.headers),
                            },
                        },
                    });

                    return response;
                },
            };

            return request(githubRouteAndMethod, {
                ...options,
                request: {
                    ...options?.request,
                    ...requestOptions,
                },
            } as any) as any;
        });
    }

    /**
     * Same as `request()` but we don't create a span. Avoid using this! We ideally
     * want to trace all network requests from our services.
     */
    public override quietlyRequestWithoutTracing<R extends keyof Endpoints>(
        githubRouteAndMethod: R,
        options?: Endpoints[R]["parameters"] & RequestParameters,
    ): Promise<Endpoints[R]["response"]> {
        const [method, githubRoute] = githubRouteAndMethod.split(" ", 2);
        assert(method !== undefined && githubRoute !== undefined);

        const requestOptions: RequestRequestOptions = {
            // Authorize the request to the GitHub API.
            hook: this._auth,

            // Add the same tracer data as `fetchWithTracer()` to requests made against the
            // GitHub API. Requests to GitHub are made with `@octokit/request` for proper
            // parsing.
            fetch: async (url: string, init?: RequestInit) => {
                const request = new Request(url, init);

                // eslint-disable-next-line cyberworlds/no-global-fetch
                const response = await fetch(request);

                return response;
            },
        };

        return request(githubRouteAndMethod, {
            ...options,
            request: {
                ...options?.request,
                ...requestOptions,
            },
        } as any) as any;
    }
}

function formatGithubRoute(route: string): string {
    return route.replaceAll(
        /\{[a-zA-Z0-9_]+\}/g,
        string => `:${convertSnakeCaseToCamelCase(string.slice(1, -1))}`,
    );
}

export class UnimplementedGithubContextModule extends GithubContextModuleBase {
    public override request(): Promise<never> {
        throw new UnimplementedError(
            quote`GitHub context module is unimplemented in ${process.env.NODE_ENV}`,
        );
    }

    public override quietlyRequestWithoutTracing(): Promise<never> {
        throw new UnimplementedError(
            quote`GitHub context module is unimplemented in ${process.env.NODE_ENV}`,
        );
    }
}
