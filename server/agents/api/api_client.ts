import createClient, {Client, FetchOptions, ParseAsResponse} from "openapi-fetch";
import {
    FilterKeys,
    HttpMethod,
    MediaType,
    PathsWithMethod,
    ResponseObjectMap,
    SuccessResponse,
} from "openapi-typescript-helpers";
import {ApiMessageRoomPathObject} from "~/shared/api/parse_api_path.js";
import {
    ApiContent,
    ApiErrorResponseBody,
    ApiMessageStreamPartPayload,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/types/api_specification_types.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
    UnknownError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
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
        // Convert path params from the OpenAPI format (`/hello/{name}`) to the
        // format expected by `fetchWithTracer()` (`/hello/:name`). Right now we only
        // support path params that are an entire path segment. Paths like
        // `/report.{format}` aren't currently accepted.
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

            return fetchWithTracer(
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
                    // If the request failed, then throw an error. We want to mark this span as
                    // failed and we don't want to handle errors inline.
                    if (!response.ok) {
                        const responseBody: ApiErrorResponseBody = await response.json();

                        let ErrorConstructor: {
                            new (
                                message: string,
                                options?: {cause?: unknown; displayMessage?: ErrorDisplayMessage},
                            ): ErrorBase;
                        };
                        switch (response.status) {
                            case 400:
                                ErrorConstructor = InvalidArgumentError;
                                break;
                            case 401:
                                ErrorConstructor = UnauthenticatedError;
                                break;
                            case 403:
                                ErrorConstructor = PermissionDeniedError;
                                break;
                            case 404:
                                ErrorConstructor = NotFoundError;
                                break;
                            default:
                                ErrorConstructor =
                                    response.status >= 500 ? InternalError : UnknownError;
                                break;
                        }

                        throw new ErrorConstructor("API request failed", {
                            // The error message might contain sensitive user data. So treat the whole
                            // error message as sensitive text.
                            displayMessage: errorDisplayMessage`${responseBody.error.message}`,
                            cause: {status: response.status, ...responseBody},
                        });
                    }

                    if (options.parseAs === "stream") {
                        return response;
                    }

                    // Parse the response body in our `fetchWithTracer()` action so the time it
                    // takes for the response body to be streamed is included in the span.
                    const responseBody = await response[options.parseAs]();

                    // Don't throw an error when `openapi-fetch` [calls this method a second
                    // time][1]. Instead return what we already parsed.
                    //
                    // [1]: https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L234-L241
                    (response as any)[options.parseAs] = () => responseBody;

                    // For error handling `openapi-fetch` [calls `response.text()` and tries to
                    // parse it as JSON][1]. So add a `text()` handler if we're parsing as JSON and
                    // the request is not ok.
                    //
                    // [1]: https://github.com/openapi-ts/openapi-typescript/blob/b24ff133a62156fb6145092884a1025cff4f2360/packages/openapi-fetch/src/index.js#L243-L250
                    if (!response.ok && options.parseAs === "json") {
                        (response as any).text = () => JSON.stringify(responseBody);
                    }

                    return response;
                },
            );
        },
    });

    function createRequest(method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH"): any {
        return (tracer: any, path: any, options: any) => {
            currentTracer = tracer;

            return (apiClient as any)[method](path, {
                ...options,
                tracer,
            });
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
    roomPathObject: ApiMessageRoomPathObject,
    index: number,
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.chatId, index}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages/{index}", {
                params: {
                    path: {
                        id: roomPathObject.documentId,
                        threadId: roomPathObject.commentThreadId,
                        index,
                    },
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.postId, index}},
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.taskId, index}},
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function getApiMessagesFromStart(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages", {
                params: {
                    path: {id: roomPathObject.chatId},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {
                    path: {
                        id: roomPathObject.documentId,
                        threadId: roomPathObject.commentThreadId,
                    },
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages", {
                params: {
                    path: {id: roomPathObject.postId},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages", {
                params: {
                    path: {id: roomPathObject.taskId},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function getApiMessagesFromEnd(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.get(tracer, "/chats/{id}/messages", {
                params: {
                    path: {id: roomPathObject.chatId},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.get(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {
                    path: {
                        id: roomPathObject.documentId,
                        threadId: roomPathObject.commentThreadId,
                    },
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "Post": {
            return apiClient.get(tracer, "/posts/{id}/messages", {
                params: {
                    path: {id: roomPathObject.postId},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "Task": {
            return apiClient.get(tracer, "/tasks/{id}/messages", {
                params: {
                    path: {id: roomPathObject.taskId},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function createApiMessage(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    body: {isStream?: boolean; content: ApiContent},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.post(tracer, "/chats/{id}/messages", {
                params: {path: {id: roomPathObject.chatId}},
                body,
            });
        }
        case "DocumentCommentThread": {
            return apiClient.post(tracer, "/documents/{id}/threads/{threadId}/messages", {
                params: {
                    path: {
                        id: roomPathObject.documentId,
                        threadId: roomPathObject.commentThreadId,
                    },
                },
                body,
            });
        }
        case "Post": {
            return apiClient.post(tracer, "/posts/{id}/messages", {
                params: {path: {id: roomPathObject.postId}},
                body,
            });
        }
        case "Task": {
            return apiClient.post(tracer, "/tasks/{id}/messages", {
                params: {path: {id: roomPathObject.taskId}},
                body,
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function putApiMessageStreamPart(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    messageIndex: number,
    partIndex: number,
    body: {payload: ApiMessageStreamPartPayload},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.put(tracer, "/chats/{id}/messages/{index}/stream/parts/{partIndex}", {
                params: {path: {id: roomPathObject.chatId, index: messageIndex, partIndex}},
                body,
            });
        }
        case "DocumentCommentThread": {
            return apiClient.put(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/parts/{partIndex}",
                {
                    params: {
                        path: {
                            id: roomPathObject.documentId,
                            threadId: roomPathObject.commentThreadId,
                            index: messageIndex,
                            partIndex,
                        },
                    },
                    body,
                },
            );
        }
        case "Post": {
            return apiClient.put(tracer, "/posts/{id}/messages/{index}/stream/parts/{partIndex}", {
                params: {path: {id: roomPathObject.postId, index: messageIndex, partIndex}},
                body,
            });
        }
        case "Task": {
            return apiClient.put(tracer, "/tasks/{id}/messages/{index}/stream/parts/{partIndex}", {
                params: {path: {id: roomPathObject.taskId, index: messageIndex, partIndex}},
                body,
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function completeApiMessageStream(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    messageIndex: number,
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.put(tracer, "/chats/{id}/messages/{index}/stream/completion", {
                params: {path: {id: roomPathObject.chatId, index: messageIndex}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.put(
                tracer,
                "/documents/{id}/threads/{threadId}/messages/{index}/stream/completion",
                {
                    params: {
                        path: {
                            id: roomPathObject.documentId,
                            threadId: roomPathObject.commentThreadId,
                            index: messageIndex,
                        },
                    },
                },
            );
        }
        case "Post": {
            return apiClient.put(tracer, "/posts/{id}/messages/{index}/stream/completion", {
                params: {path: {id: roomPathObject.postId, index: messageIndex}},
            });
        }
        case "Task": {
            return apiClient.put(tracer, "/tasks/{id}/messages/{index}/stream/completion", {
                params: {path: {id: roomPathObject.taskId, index: messageIndex}},
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}
