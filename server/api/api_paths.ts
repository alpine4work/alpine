import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
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

export type ApiPathsBase = {
    readonly [path: string]: {
        readonly [method: string]: (
            context: ServerProcessContext,
            options: {
                pathParams: any;
                searchParams: URLSearchParams;
                headers: Headers;
                span: TracerSpan;
            },
        ) => Promise<{content: any}>;
    };
};

export const apiPaths: {
    readonly [Path in keyof ApiSpecification.paths]: {
        readonly [Method in keyof Pick<ApiSpecification.paths[Path], OpenApiMethod>]: (
            context: ServerProcessContext,
            options: {
                pathParams: ApiOperationPathParametersType<Path, Method>;
                searchParams: URLSearchParams;
                headers: Headers;
                span: TracerSpan;
            },
        ) => Promise<{content: ApiOperation200JsonResponseType<Path, Method>}>;
    };
} = {
    "/ping": {
        // TODO(calebmer, #api): Remove this route
        get: async () => {
            return {
                content: {pong: true},
            };
        },
    },
    "/hello/{name}": {
        // TODO(calebmer, #api): Remove this route
        get: async (context, {pathParams}) => {
            return {
                content: {
                    message: `Hello, ${pathParams.name}!`,
                    ...(pathParams.name === "test-additional-property" ? {answer: 42} : {}),
                },
            };
        },
    },
    "/documents/{id}": {
        // TODO(calebmer, #api): Remove this route
        get: async () => {
            return {content: {title: "Lorem Ipsum"}};
        },
    },
};

assertAssignableTypes<typeof apiPaths, ApiPathsBase>();
