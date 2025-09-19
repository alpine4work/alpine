import createOpenapiClient, {Client as OpenapiClient} from "openapi-fetch";
import {ApiMessageRoomPathObject} from "~/server/api/specification/parse_api_path.js";
import {
    ApiContent,
    ApiErrorResponseBody,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export type ApiClient = OpenapiClient<ApiSpecification.paths>;

export function createApiClient(
    tracer: TracerBase,
    {
        baseUrl,
        apiKey,
        accessToken,
    }: {
        baseUrl: string;
        apiKey: string;
        accessToken: string;
    },
): ApiClient {
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

    const apiClient: ApiClient = createOpenapiClient({
        baseUrl,
        headers: {
            authorization: `bearer ${apiKey}~${accessToken}`,
        },
    });

    apiClient.use({
        onRequest: ({request, schemaPath, options}) => {
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

                        throw new InternalError(
                            `API request failed: ${responseBody.error.message}`,
                            {cause: {status: response.status, ...responseBody}},
                        );
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

    return apiClient;
}

export function getApiMessage(
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    index: number,
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.GET("/chats/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.chatId, index}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.GET("/documents/{id}/threads/{threadId}/messages/{index}", {
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
            return apiClient.GET("/posts/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.postId, index}},
            });
        }
        case "Task": {
            return apiClient.GET("/tasks/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.taskId, index}},
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}

export function getApiMessagesFromStart(
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.GET("/chats/{id}/messages", {
                params: {
                    path: {id: roomPathObject.chatId},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.GET("/documents/{id}/threads/{threadId}/messages", {
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
            return apiClient.GET("/posts/{id}/messages", {
                params: {
                    path: {id: roomPathObject.postId},
                    query: {limit, cursor: cursor ?? undefined},
                },
            });
        }
        case "Task": {
            return apiClient.GET("/tasks/{id}/messages", {
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
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    {limit, cursor}: {limit: number; cursor: number | null},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.GET("/chats/{id}/messages", {
                params: {
                    path: {id: roomPathObject.chatId},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "DocumentCommentThread": {
            return apiClient.GET("/documents/{id}/threads/{threadId}/messages", {
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
            return apiClient.GET("/posts/{id}/messages", {
                params: {
                    path: {id: roomPathObject.postId},
                    query: {limit, cursor: cursor ?? undefined, from: "end"},
                },
            });
        }
        case "Task": {
            return apiClient.GET("/tasks/{id}/messages", {
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
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    body: {content: ApiContent},
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.POST("/chats/{id}/messages", {
                params: {path: {id: roomPathObject.chatId}},
                body,
            });
        }
        case "DocumentCommentThread": {
            return apiClient.POST("/documents/{id}/threads/{threadId}/messages", {
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
            return apiClient.POST("/posts/{id}/messages", {
                params: {path: {id: roomPathObject.postId}},
                body,
            });
        }
        case "Task": {
            return apiClient.POST("/tasks/{id}/messages", {
                params: {path: {id: roomPathObject.taskId}},
                body,
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}
