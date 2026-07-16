import createClient, {Client, FetchOptions, ParseAsResponse} from "openapi-fetch";
import {
    FilterKeys,
    HttpMethod,
    MediaType,
    PathsWithMethod,
    ResponseObjectMap,
    SuccessResponse,
} from "openapi-typescript-helpers";
import {
    ApiContent,
    ApiErrorResponseBody,
    ApiMentionResponse,
    ApiMentionTarget,
    ApiMessageContentPayloadParent,
    ApiMessageExperimentalApprovalDecisionValue,
    ApiMessageRoomTarget,
    ApiMessageStreamPartPayload,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {getErrorCodeForHttpStatusCode} from "~/shared/error/get_error_code_for_http_status_code.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

type ApiClientMethod<Paths extends {}, Method extends HttpMethod, Media extends MediaType> = <
    Path extends PathsWithMethod<Paths, Method>,
    Options extends FetchOptions<FilterKeys<Paths[Path], Method>>,
>(
    tracer: TracerBase,
    url: Path,
    options: Options,
) => Promise<{
    data: ParseAsResponse<
        SuccessResponse<
            // @ts-expect-error: This code was copied from `openapi-fetch`. It doesn't
            // error when in `openapi-fetch`'s `.d.ts` files because we set
            // `"skipLibCheck": true` in our `tsconfig.json`. This code might not type
            // check here in the generic type definition but it works!
            ResponseObjectMap<Paths[Path][Method]>,
            Media
        >,
        Options
    >;
    response: Response;
}>;

export type ApiClient = {
    get: ApiClientMethod<ApiSpecification.paths, "get", MediaType>;
    put: ApiClientMethod<ApiSpecification.paths, "put", MediaType>;
    post: ApiClientMethod<ApiSpecification.paths, "post", MediaType>;
    delete: ApiClientMethod<ApiSpecification.paths, "delete", MediaType>;
    patch: ApiClientMethod<ApiSpecification.paths, "patch", MediaType>;
};

export function createApiClient({
    baseUrl,
    apiKey,
    accessToken,
}: {
    baseUrl: string;
    apiKey: string;
    accessToken: string;
}): ApiClient {
    const routeBySchemaPath = new DefaultMap<string, string>(schemaPath => {
        // Convert path params from the OpenAPI format (`/hello/{name}`) to the format
        // expected by `fetchWithTracer()` (`/hello/:name`). Right now we only support path
        // params that are an entire path segment. Paths like `/report.{format}` aren't
        // currently accepted.
        const route = schemaPath
            .split("/")
            .map(pathSegment => {
                if (!pathSegment.startsWith("{")) {
                    assert(!/[{}]/.test(pathSegment));
                    return pathSegment;
                }

                assert(pathSegment.endsWith("}"));

                const pathParamName = pathSegment.slice(1, -1);
                assert(isIdentifier(pathParamName));

                return `:${pathParamName}`;
            })
            .join("/");

        return route;
    });

    const apiClient: Client<ApiSpecification.paths> = createClient({
        baseUrl,
        headers: {
            authorization: `bearer ${apiKey}~${accessToken}`,
        },
    });

    let currentTracer: TracerBase | null = null;

    apiClient.use({
        onRequest: ({request, schemaPath, options}) => {
            const tracer = assertExists(currentTracer);
            currentTracer = null;

            // Define the fetch operation
            return retryWithExponentialBackoff(
                retry =>
                    fetchWithTracer(
                        tracer,
                        request.url,
                        {
                            serviceName: "ApiService",
                            route: routeBySchemaPath.getOrSetDefault(schemaPath),
                            method: request.method,
                            headers: request.headers,
                            body: request.body,
                            signal: request.signal,
                        },
                        async response => {
                            // If the request failed, then throw an error. We want to mark this span as failed
                            // and we don't want to handle errors inline.
                            if (!response.ok) {
                                const responseBody: ApiErrorResponseBody = await response.json();

                                // Our API doesn't share the internal `ErrorCode` we use, so infer an error code
                                // from the HTTP status code.
                                const errorCode = getErrorCodeForHttpStatusCode(response.status);
                                const ErrorConstructor = getErrorConstructorForCode(errorCode);

                                const error = new ErrorConstructor("API request failed", {
                                    // The error message might contain sensitive user data. So treat the whole error
                                    // message as sensitive text.
                                    displayMessage: errorDisplayMessage`${responseBody.error.message}`,
                                    cause: {status: response.status, ...responseBody},
                                });

                                if (responseBody.error.retry.able) {
                                    throw retry(error);
                                } else {
                                    throw error;
                                }
                            }

                            if (options.parseAs === "stream") {
                                return response;
                            }

                            // Parse the response body in our `fetchWithTracer()` action so the time it takes
                            // for the response body to be streamed is included in the span.
                            const responseBody = await response[options.parseAs]();

                            // Don't throw an error when `openapi-fetch` [calls this method a second time][1].
                            // Instead return what we already parsed.
                            //
                            // [1]:
                            //     https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L234-L241
                            (response as any)[options.parseAs] = () => responseBody;

                            // For error handling `openapi-fetch` [calls `response.text()` and tries to parse
                            // it as JSON][1]. So add a `text()` handler if we're parsing as JSON and the
                            // request is not ok.
                            //
                            // [1]:
                            //     https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L243-L250
                            if (!response.ok && options.parseAs === "json") {
                                (response as any).text = () => JSON.stringify(responseBody);
                            }

                            return response;
                        },
                    ),
                {maxAttemptCount: 5},
            );
        },
    });

    function createRequest(method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH"): any {
        return (tracer: any, path: any, options: any) => {
            currentTracer = tracer;

            return (apiClient as any)[method](path, options);
        };
    }

    return {
        get: createRequest("GET"),
        put: createRequest("PUT"),
        post: createRequest("POST"),
        delete: createRequest("DELETE"),
        patch: createRequest("PATCH"),
    };
}

export function getApiMessage(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    index: number,
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages/{index}", {
                params: {path: {id: room.id, index}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages/{index}", {
                params: {
                    path: {
                        id: room.id,
                        threadId: room.threadId,
                        index,
                    },
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages/{index}", {
                params: {path: {id: room.id, index}},
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages/{index}", {
                params: {path: {id: room.id, index}},
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function getApiMessagesFromStart(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {
                    path: {
                        id: room.id,
                        threadId: room.threadId,
                    },
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function getApiMessagesFromEnd(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {
                    path: {
                        id: room.id,
                        threadId: room.threadId,
                    },
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages", {
                params: {
                    path: {id: room.id},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function createApiMessage(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    body: {
        isStream?: boolean;
        parent?: ApiMessageContentPayloadParent;
        content: ApiContent;
        createdTimeZone?: TimeZone;
    },
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.post(tracer, "/chats/{id}/messages", {
                params: {path: {id: room.id}},
                body,
            });
        }
        case "DocumentCommentThread": {
            return apiClient.post(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {path: {id: room.id, threadId: room.threadId}},
                body,
            });
        }
        case "Post": {
            return apiClient.post(tracer, "/posts/{id}/messages", {
                params: {path: {id: room.id}},
                body,
            });
        }
        case "Task": {
            return apiClient.post(tracer, "/tasks/{id}/messages", {
                params: {path: {id: room.id}},
                body,
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function createApiMessageStreamPart(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
    body: {payload: ApiMessageStreamPartPayload},
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.post(tracer, "/chats/{id}/messages/{index}/stream/parts", {
                params: {path: {id: room.id, index: messageIndex}},
                body,
            });
        }
        case "DocumentCommentThread": {
            return apiClient.post(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/parts",
                {
                    params: {
                        path: {
                            id: room.id,
                            threadId: room.threadId,
                            index: messageIndex,
                        },
                    },
                    body,
                },
            );
        }
        case "Post": {
            return apiClient.post(tracer, "/posts/{id}/messages/{index}/stream/parts", {
                params: {path: {id: room.id, index: messageIndex}},
                body,
            });
        }
        case "Task": {
            return apiClient.post(tracer, "/tasks/{id}/messages/{index}/stream/parts", {
                params: {path: {id: room.id, index: messageIndex}},
                body,
            });
        }
        default:
            throw exhaustive(room);
    }
}

export const putApiMessageStreamPartBeforeFetchTestCheckpoint = new TestCheckpoint<
    [number, number]
>();

export async function putApiMessageStreamPart(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
    partIndex: number,
    body: {payload: ApiMessageStreamPartPayload},
) {
    // Micro-optimization, `waitForTest()` is noops if `!import.meta.jest` anyway but
    // `response.output_text.delta` is a hot code path in production. So add an extra
    // `import.meta.jest` check here to make sure we don't pay the microtask price in
    // production (an `await` schedules a microtask even when immediately resolved).
    if (import.meta.jest) {
        await putApiMessageStreamPartBeforeFetchTestCheckpoint.waitForTest([
            messageIndex,
            partIndex,
        ]);
    }

    switch (room.type) {
        case "Chat": {
            return await apiClient.put(
                tracer,
                "/chats/{id}/messages/{index}/stream/parts/{partIndex}",
                {
                    params: {path: {id: room.id, index: messageIndex, partIndex}},
                    body,
                },
            );
        }
        case "DocumentCommentThread": {
            return await apiClient.put(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/parts/{partIndex}",
                {
                    params: {
                        path: {
                            id: room.id,
                            threadId: room.threadId,
                            index: messageIndex,
                            partIndex,
                        },
                    },
                    body,
                },
            );
        }
        case "Post": {
            return await apiClient.put(
                tracer,
                "/posts/{id}/messages/{index}/stream/parts/{partIndex}",
                {
                    params: {path: {id: room.id, index: messageIndex, partIndex}},
                    body,
                },
            );
        }
        case "Task": {
            return await apiClient.put(
                tracer,
                "/tasks/{id}/messages/{index}/stream/parts/{partIndex}",
                {
                    params: {path: {id: room.id, index: messageIndex, partIndex}},
                    body,
                },
            );
        }
        default:
            throw exhaustive(room);
    }
}

export async function patchApiMessageApprovals(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
    decisions: ReadonlyArray<{index: number; value: ApiMessageExperimentalApprovalDecisionValue}>,
) {
    const body = {
        patches: decisions.map(decision => ({
            type: "SetDecisionValue" as const,
            index: decision.index,
            decision: {
                value: decision.value,
            },
        })),
    };

    switch (room.type) {
        case "Chat": {
            return await apiClient.patch(
                tracer,
                "/chats/{id}/messages/{index}/experimental-approvals",
                {
                    params: {path: {id: room.id, index: messageIndex}},
                    body,
                },
            );
        }
        case "DocumentCommentThread": {
            return await apiClient.patch(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/experimental-approvals",
                {
                    params: {
                        path: {
                            id: room.id,
                            threadId: room.threadId,
                            index: messageIndex,
                        },
                    },
                    body,
                },
            );
        }
        case "Post": {
            return await apiClient.patch(
                tracer,
                "/posts/{id}/messages/{index}/experimental-approvals",
                {
                    params: {path: {id: room.id, index: messageIndex}},
                    body,
                },
            );
        }
        case "Task": {
            return await apiClient.patch(
                tracer,
                "/tasks/{id}/messages/{index}/experimental-approvals",
                {
                    params: {path: {id: room.id, index: messageIndex}},
                    body,
                },
            );
        }
        default:
            throw exhaustive(room);
    }
}

export function getApiMessageApprovals(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages/{index}/experimental-approvals", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/experimental-approvals",
                {
                    params: {path: {id: room.id, threadId: room.threadId, index: messageIndex}},
                },
            );
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages/{index}/experimental-approvals", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages/{index}/experimental-approvals", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function completeApiMessageStream(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.put(tracer, "/chats/{id}/messages/{index}/stream/completion", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.put(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/completion",
                {
                    params: {
                        path: {
                            id: room.id,
                            threadId: room.threadId,
                            index: messageIndex,
                        },
                    },
                },
            );
        }
        case "Post": {
            return apiClient.put(tracer, "/posts/{id}/messages/{index}/stream/completion", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        case "Task": {
            return apiClient.put(tracer, "/tasks/{id}/messages/{index}/stream/completion", {
                params: {path: {id: room.id, index: messageIndex}},
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function pingApiMessageStream(
    tracer: TracerBase,
    apiClient: ApiClient,
    room: ApiMessageRoomTarget,
    messageIndex: number,
) {
    switch (room.type) {
        case "Chat": {
            return apiClient.put(tracer, "/chats/{id}/messages/{index}/stream/ping", {
                params: {
                    path: {id: room.id, index: messageIndex},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.put(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/ping",
                {
                    params: {
                        path: {
                            id: room.id,
                            threadId: room.threadId,
                            index: messageIndex,
                        },
                    },
                },
            );
        }
        case "Post": {
            return apiClient.put(tracer, "/posts/{id}/messages/{index}/stream/ping", {
                params: {
                    path: {id: room.id, index: messageIndex},
                },
            });
        }
        case "Task": {
            return apiClient.put(tracer, "/tasks/{id}/messages/{index}/stream/ping", {
                params: {
                    path: {id: room.id, index: messageIndex},
                },
            });
        }
        default:
            throw exhaustive(room);
    }
}

export function getApiMention(
    tracer: TracerBase,
    apiClient: ApiClient,
    target: ApiMentionTarget,
): Promise<{data: {mention: ApiMentionResponse}}> {
    switch (target.type) {
        case "Account": {
            return apiClient.get(tracer, "/accounts/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Document": {
            return apiClient.get(tracer, "/documents/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Channel": {
            return apiClient.get(tracer, "/channels/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Task":
            return apiClient.get(tracer, "/tasks/{id}/mention", {
                params: {path: {id: target.id}},
            });
        case "TaskCollection": {
            return apiClient.get(tracer, "/task-collections/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        case "Site": {
            return apiClient.get(tracer, "/sites/{id}/mention", {
                params: {path: {id: target.id}},
            });
        }
        default: {
            throw exhaustive(target);
        }
    }
}
