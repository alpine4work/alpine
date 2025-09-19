import {intoApiMessagePayload} from "~/server/api/into_api_message_payload.js";
import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";
import {getChatMessagePayload} from "~/server/chat/data/chat_actions.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {getDocumentCommentPayload} from "~/server/documents/data/documents_actions.js";
import {getPostCommentPayload} from "~/server/forum/data/forum_actions.js";
import {getTaskCommentPayload} from "~/server/tasks/data/task_table.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type OpenApiMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

type ApiOperationPathParametersType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {parameters: {path: infer PathParameters}}
    ? PathParameters
    : {};

type ApiOperation200JsonResponseType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    responses: {200: {content: {"application/json": infer JsonResponse}}};
}
    ? JsonResponse
    : {};

type ApiOperationJsonRequestType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    requestBody: {content: {"application/json": infer JsonRequest}};
}
    ? JsonRequest
    : null;

export type ApiPathsBase = {
    readonly [path: string]: {
        readonly [method: string]: (
            context: ServerBotActionContext,
            options: {
                pathParams: any;
                searchParams: URLSearchParams;
                headers: Headers;
                requestBody: any;
                span: TracerSpan;
            },
        ) => Promise<{content: any}>;
    };
};

export const apiPaths: {
    readonly [Path in keyof ApiSpecification.paths]: {
        readonly [Method in keyof Pick<ApiSpecification.paths[Path], OpenApiMethod>]: (
            context: ServerBotActionContext,
            options: {
                pathParams: ApiOperationPathParametersType<Path, Method>;
                searchParams: URLSearchParams;
                headers: Headers;
                requestBody: ApiOperationJsonRequestType<Path, Method>;
                span: TracerSpan;
            },
        ) => Promise<{content: ApiOperation200JsonResponseType<Path, Method>}>;
    };
} = {
    "/chats/{id}/messages/{index}": {
        get: async (context, {pathParams, searchParams}) => {
            const message = await getChatMessagePayload(context, {
                chatId: pathParams.id,
                messageIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            const content: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> =
                {
                    roomPath: `/chats/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                };

            // We want to test that response schemas are validated in a Jest unit test. So
            // allow adding a search param to trigger a response validation failure.
            if (import.meta.jest && searchParams.has("test-additional-property")) {
                (content as any).additionalProperty = searchParams.get("test-additional-property");
            }

            return {
                content,
            };
        },
    },
    "/documents/{id}/threads/{threadId}/messages/{index}": {
        get: async (context, {pathParams}) => {
            // TODO(calebmer, #api): Tests!
            const message = await getDocumentCommentPayload(context, {
                documentId: pathParams.id,
                commentThreadId: pathParams.threadId,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/documents/${pathParams.id}/threads/${pathParams.threadId}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
    "/posts/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            // TODO(calebmer, #api): Tests!
            const message = await getPostCommentPayload(context, {
                postId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/posts/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
    "/tasks/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            // TODO(calebmer, #api): Tests!
            const message = await getTaskCommentPayload(context, {
                taskId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/tasks/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
};

assertAssignableTypes<typeof apiPaths, ApiPathsBase>();
