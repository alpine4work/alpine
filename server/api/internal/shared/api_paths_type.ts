import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * The type of our API implementation.
 */
export type ApiPaths = {
    readonly [Path in keyof ApiSpecification.paths]: {
        readonly [Method in keyof Pick<ApiSpecification.paths[Path], OpenApiMethod>]: (
            context: ApiServiceBotActionContext,
            options: {
                pathParameters: ApiOperationPathParametersType<Path, Method>;
                queryParameters: ApiOperationQueryParametersType<Path, Method>;
                url: URL;
                headers: Headers;
                requestBody: ApiOperationJsonRequestType<Path, Method>;
                span: TracerSpan;
            },
        ) => Promise<ApiOperationResultType<Path, Method>>;
    };
};

/**
 * The base type of our API implementation. `ApiPaths` is assignable to this type.
 * Can be easier to use since this type has dynamic string keys and doesn't bother
 * itself with generic types.
 */
export type ApiPathsBase = {
    readonly [path: string]: {
        readonly [method: string]: (
            context: ApiServiceBotActionContext,
            options: {
                pathParameters: any;
                queryParameters: any;
                url: URL;
                headers: Headers;
                requestBody: any;
                span: TracerSpan;
            },
        ) => Promise<{content: any} | {response: Response}>;
    };
};

assertAssignableTypes<ApiPaths, ApiPathsBase>();

type OpenApiMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

type ApiOperationPathParametersType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {parameters: {path: infer PathParameters}}
    ? PathParameters
    : {};

type ApiOperationQueryParametersType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {parameters: {query?: infer QueryParameters}}
    ? QueryParameters
    : {};

export type ApiOperation200JsonResponseType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    responses: {200: {content: {"application/json": infer JsonResponse}}};
}
    ? JsonResponse
    : {};

/**
 * Resolves the return type for an API operation handler. Binary response endpoints
 * (e.g. `application/octet-stream`) return `{response: Response}`, while JSON
 * endpoints return `{content: ...}`.
 */
type ApiOperationResultType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    responses: {200: {content: {"application/json": infer JsonResponse}}};
}
    ? {content: JsonResponse}
    : {response: Response};

type ApiOperationJsonRequestType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    requestBody: {content: {"application/json": infer JsonRequest}};
}
    ? JsonRequest
    : null;
