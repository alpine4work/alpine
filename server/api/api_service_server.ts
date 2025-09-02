import {Ajv} from "ajv";
import FindMyWay from "find-my-way";
import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import Negotiator from "negotiator";
import {OpenAPIV3} from "openapi-types";
import {join as joinPath} from "path";
import Yaml from "yaml";
import {renderApiBrowser} from "~/server/api/api_browser.js";
import {ApiPathsBase, apiPaths} from "~/server/api/api_paths.js";
import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    createStandardizedServerBase,
    standardizedRequestListener,
} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// NOTE(calebmer, #public-api): The intent is to someday expose `ApiService` as
// our public API. For now it's only used by our AI agent bots. As we work on
// `ApiService` we'll leave comments with #public-api for anything we want to
// revisit when preparing for public launch of the API.

const apiSpecificationPath = joinPath(
    runfilesPath,
    "cyberworlds/server/api/specification/api_specification_final.yaml",
);

export async function createApiServiceServer(
    processContext: ServerProcessContext,
    {
        shutdownManager,
        edgeServiceUrl,
    }: {
        shutdownManager: ShutdownManager;
        edgeServiceUrl: string;
    },
) {
    const requestListener = await createApiServiceRequestListener(processContext, {edgeServiceUrl});

    return createStandardizedServerBase(
        processContext.tracer.getRoot(),
        shutdownManager,
        requestListener,
    );
}

export async function createApiServiceRequestListener(
    processContext: ServerProcessContext,
    {
        edgeServiceUrl,
    }: {
        edgeServiceUrl: string;
    },
) {
    const tracer = processContext.tracer.getRoot();

    const apiSpecificationString = await fs.readFile(apiSpecificationPath, "utf8");
    const apiSpecification: OpenAPIV3.Document = Yaml.parse(apiSpecificationString);

    function resolveReference<Value extends object>(
        value: Value | OpenAPIV3.ReferenceObject,
    ): Value {
        if (!("$ref" in value)) return value;

        assert(value.$ref.startsWith("#/"));
        const refPathSegments = value.$ref.slice(2).split("/");

        let refValue: any = apiSpecification;

        for (const refPathSegment of refPathSegments) {
            refValue = refValue?.[refPathSegment];
        }

        return refValue;
    }

    const createRequestListener = (
        route: string,
        action: (
            span: TracerSpan,
            request: Request,
            url: URL,
            pathParams: unknown,
        ) => Promise<Response>,
    ) => {
        return (
            req: IncomingMessage,
            res: ServerResponse<IncomingMessage>,
            pathParams: unknown,
        ) => {
            standardizedRequestListener(tracer, req, res, async request => {
                const url = new URL(request.url);

                // TODO(calebmer, #public-api): `traceServerResponse()` looks for the
                // `cyberworlds-tracer-propagation-context` to continue a request trace.
                // Ideally we wouldn't respect this header from public API calls (only from
                // internal API calls) since it would allow public API users to mess with our
                // traces (though maybe it's not an issue since what's the use case for that?).
                return traceServerResponse(tracer, request, url, route, async (span, request) => {
                    const response = await action(span, request, url, pathParams);

                    if (
                        request.headers.has("accept") &&
                        response.headers.get("content-type") === "application/json"
                    ) {
                        const negotiator = new Negotiator(req);
                        const negotiatedMediaType = negotiator.mediaType([
                            "text/html",
                            "application/json",
                        ]);

                        if (negotiatedMediaType === "text/html") {
                            return renderApiBrowser({
                                request,
                                response,
                                edgeServiceUrl,
                                url,
                                route,
                            });
                        }
                    }

                    return response;
                });
            });
        };
    };

    const defaultRequestListener = createRequestListener("/*", async () => {
        return createApiErrorResponse({
            status: 404,
            message: "Path not found.",
        });
    });

    const router = FindMyWay({
        // We'll parse the query string ourselves with `new URL()`.
        querystringParser: () => null,
        defaultRoute: (req, res) => defaultRequestListener(req, res, {}),
    });

    // Redirect some requests (e.g. `favicon.svg` to `https://alpine.inc/favicon.svg`)
    // for users opening the API in their browser.
    const redirectPaths = ["/favicon.svg", "/favicon.ico"];

    for (const redirectPath of redirectPaths) {
        router.on("GET", redirectPath, (req, res) => {
            standardizedRequestListener(tracer, req, res, async request => {
                const url = new URL(request.url);

                return traceServerResponse(tracer, request, url, redirectPath, async () => {
                    return new Response(null, {
                        status: 301,
                        headers: {location: `${edgeServiceUrl}${redirectPath}`},
                    });
                });
            });
        });
    }

    const ajv = new Ajv({
        strict: false,
        // `discriminator` is a OpenAPI feature that's not enabled by default.
        discriminator: true,
    });

    const ajvSharedSchemaName = "shared.yaml";
    ajv.addSchema(apiSpecification, ajvSharedSchemaName);

    function compileWithAjv(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject) {
        schema = updateRefsForAjv(schema as JsonValue) as
            | OpenAPIV3.SchemaObject
            | OpenAPIV3.ReferenceObject;

        return ajv.compile(schema);
    }

    function updateRefsForAjv(value: JsonValue): JsonValue {
        if (isReadonlyArray(value)) {
            return value.map(updateRefsForAjv);
        } else if (isObject(value)) {
            // In order to reference component schemas in the OpenAPI specification, we
            // can't reference relative paths and instead need to reference an absolute
            // path created for AJV.
            if (typeof value.$ref === "string" && value.$ref.startsWith("#")) {
                return {$ref: ajvSharedSchemaName + value.$ref};
            }

            return mapObjectValues(value, keyValue =>
                keyValue !== undefined ? updateRefsForAjv(keyValue) : undefined,
            );
        } else {
            return cast<JsonScalarValue>(value);
        }
    }

    for (const [openApiPath, openApiPathItem] of Object.entries(apiSpecification.paths)) {
        if (!openApiPathItem) continue;

        // Convert path params from the OpenAPI format (`/hello/{name}`) to the
        // `find-my-way` format (`/hello/:name`). Right now we only support path params
        // that are an entire path segment. Paths like `/report.{format}` aren't
        // currently accepted.
        const findMyWayPath = openApiPath
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

        let firstFindMyWayMethod: string | null = null;

        for (const openApiMethod of Object.values(OpenAPIV3.HttpMethods)) {
            const findMyWayMethod = openApiMethod.toUpperCase() as FindMyWay.HTTPMethod;
            firstFindMyWayMethod ??= findMyWayMethod;
            const openApiOperation = openApiPathItem[openApiMethod];

            const parameters = [
                ...(openApiPathItem.parameters ?? emptyArray),
                ...(openApiOperation?.parameters ?? emptyArray),
            ];

            const pathParamsSchema = {
                type: "object",
                properties: cast<{
                    [key: string]: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
                }>({}),
                required: cast<Array<string>>([]),
                additionalProperties: false,
            } as const;

            for (let parameter of parameters) {
                parameter = resolveReference(parameter);
                assert(parameter.in === "path");
                assert(parameter.schema);
                assert(!pathParamsSchema.properties[parameter.name]);

                pathParamsSchema.properties[parameter.name] = parameter.schema;
                if (parameter.required) pathParamsSchema.required.push(parameter.name);
            }

            const validatePathParams = compileWithAjv(pathParamsSchema);

            // In development and test environments, we validate that the API response
            // matches what's in our OpenAPI schema. In production for performance we
            // don't validate and assume our code is correct.
            const debugValidateResponseJsonContentByStatus =
                process.env.NODE_ENV !== "production" && openApiOperation?.responses
                    ? mapObjectValues(openApiOperation.responses, response => {
                          response = resolveReference(response);
                          assert(response.content?.["application/json"]?.schema);
                          return compileWithAjv(response.content?.["application/json"]?.schema);
                      })
                    : null;

            const executeOperation = assertExists(cast<ApiPathsBase>(apiPaths)[openApiPath])[
                openApiMethod
            ];

            // If `openApiOperation` isn't undefined then `executeOperation` also shouldn't
            // be undefined.
            assert((openApiOperation === undefined) === (executeOperation === undefined));

            const requestListener = createRequestListener(
                findMyWayPath,
                async (span, request, url, pathParams) => {
                    const valid = validatePathParams(pathParams);
                    if (!valid) {
                        const propertyName = findMapIterable(
                            validatePathParams.errors ?? emptyArray,
                            error => {
                                if (error.propertyName) {
                                    return error.propertyName;
                                }

                                // `ajv` seems to use `instancePath` for the error when the schema is a `$ref`.
                                if (
                                    error.instancePath.startsWith("/") &&
                                    !error.instancePath.slice(1).includes("/")
                                ) {
                                    return error.instancePath.slice(1);
                                }
                            },
                        );

                        return createApiErrorResponse({
                            status: 400,
                            message: propertyName
                                ? quote`Invalid ${propertyName} path parameter.`
                                : "Invalid path parameters.",
                        });
                    }

                    if (executeOperation === undefined) {
                        return createApiErrorResponse({
                            status: 405,
                            message: quote`${findMyWayMethod} method isn’t supported, try ${firstFindMyWayMethod}.`,
                        });
                    }

                    try {
                        const {content} = await executeOperation(processContext, {
                            pathParams,
                            searchParams: url.searchParams,
                            headers: request.headers,
                            span,
                        });

                        const status = 200;

                        // In development and test environments, validate that our API response matches
                        // what's in the OpenAPI schema.
                        if (process.env.NODE_ENV !== "production") {
                            const debugValidateResponseJsonContent =
                                debugValidateResponseJsonContentByStatus?.[status] ??
                                debugValidateResponseJsonContentByStatus?.default;

                            assert(
                                debugValidateResponseJsonContent,
                                quote`Missing response schema for ${status} status`,
                            );

                            if (!debugValidateResponseJsonContent(content)) {
                                throw new InternalError(
                                    `Response schema validation failed: ${
                                        debugValidateResponseJsonContent.errors?.[0]?.message ?? ""
                                    }`,
                                );
                            }
                        }

                        return new Response(JSON.stringify(content), {
                            status,
                            headers: {"content-type": "application/json"},
                        });
                    } catch (error) {
                        // Make sure the error is included in our HTTP request span.
                        span.addException(error);

                        let status: number;
                        let displayMessage: ErrorDisplayMessage;

                        // If there's no display message, always return a 500. Expected errors should
                        // always include a display message.
                        if (!(error instanceof ErrorBase && error.displayMessage)) {
                            status = 500;
                            displayMessage = defaultErrorDisplayMessage;
                        } else {
                            displayMessage = error.displayMessage;

                            switch (error.code) {
                                case ErrorCode.NotFound:
                                    status = 404;
                                    break;
                                case ErrorCode.PermissionDenied:
                                    status = 403;
                                    break;
                                case ErrorCode.Unauthenticated:
                                    status = 401;
                                    break;
                                default:
                                    status = isSystemErrorCode(error.code) ? 500 : 400;
                                    break;
                            }
                        }

                        return createApiErrorResponse({
                            status,
                            message: renderErrorDisplayMessage(displayMessage),
                            stack: error instanceof Error ? error.stack : undefined,
                        });
                    }
                },
            );

            router.on(findMyWayMethod, findMyWayPath, requestListener);
        }
    }

    return (req: IncomingMessage, res: ServerResponse<IncomingMessage>): void => {
        router.lookup(req, res);
    };
}

function createApiErrorResponse({
    status,
    message,
    stack,
}: {
    status: number;
    message: string;
    stack?: string;
}) {
    const body = cast<
        ApiSpecification.components["responses"]["Error"]["content"]["application/json"] & {
            error: {stack?: string};
        }
    >({
        error: {
            message,

            // In development environments, include the stack trace (even though it's not
            // declared in the OpenAPI spec).
            stack: process.env.NODE_ENV !== "production" ? stack : undefined,
        },
    });

    return new Response(JSON.stringify(body), {
        status,
        headers: {"content-type": "application/json"},
    });
}

function renderErrorDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
                string += segment.text;
                break;

            case "SensitiveText":
                string += segment.text;
                break;

            // We don't include URLs in API error messages. Since an error message won't be
            // rendered in an interactive context.
            case "Link":
                string += segment.text;
                break;

            default:
                throw exhaustive(segment);
        }
    }

    return string;
}
