import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {ApiSpecification} from "~/shared/api/types/api_specification_types.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * The type of our API implementation.
 */
export type ApiPaths = {
    readonly [Path in keyof ApiSpecification.paths]: {
        readonly [Method in keyof Pick<ApiSpecification.paths[Path], OpenApiMethod>]: (
            context: ServerBotActionContext,
            options: {
                pathParameters: ApiOperationPathParametersType<Path, Method>;
                queryParameters: ApiOperationQueryParametersType<Path, Method>;
                url: URL;
                headers: Headers;
                requestBody: ApiOperationJsonRequestType<Path, Method>;
                span: TracerSpan;
            },
        ) => Promise<{content: ApiOperation200JsonResponseType<Path, Method>}>;
    };
};

/**
 * The base type of our API implementation. `ApiPaths` is assignable to this
 * type. Can be easier to use since this type has dynamic string keys and
 * doesn't bother itself with generic types.
 */
export type ApiPathsBase = {
    readonly [path: string]: {
        readonly [method: string]: (
            context: ServerBotActionContext,
            options: {
                pathParameters: any;
                queryParameters: any;
                url: URL;
                headers: Headers;
                requestBody: any;
                span: TracerSpan;
            },
        ) => Promise<{content: any}>;
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

type ApiOperationJsonRequestType<
    Path extends keyof ApiSpecification.paths,
    Method extends OpenApiMethod,
> = ApiSpecification.paths[Path][Method] extends {
    requestBody: {content: {"application/json": infer JsonRequest}};
}
    ? JsonRequest
    : null;
