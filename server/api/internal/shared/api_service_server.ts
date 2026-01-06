import {Ajv} from "ajv";
import _addAjvFormats from "ajv-formats";
import {parse as parseCookieHeader} from "cookie";
import FindMyWay from "find-my-way";
import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import Negotiator from "negotiator";
import {OpenAPIV3} from "openapi-types";
import {join as joinPath} from "path";
import Yaml from "yaml";
import {renderApiBrowser} from "~/server/api/internal/shared/api_browser.js";
import {ApiPathsBase} from "~/server/api/internal/shared/api_paths_type.js";
import {ApiServiceProcessContext} from "~/server/api/internal/shared/api_service_context.js";
import {getApiKeyAttributesIfExists} from "~/server/bots/bots_table.js";
import {BotActorContextModule} from "~/server/helpers/actor_context_module.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    createStandardizedServerBase,
    standardizedRequestListener,
} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {getSpaceAccountBotIdIfExistsWithoutAuthorization} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    BotTokenPayload,
    BotTokenPayloadScope,
    TokenPayload,
} from "~/server/tokens/token_payload.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {ApiSpecification} from "~/shared/api/types/api_specification_types.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase, InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {isApiKey} from "~/shared/id/api_key.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// Node.js ESM interop (#node-esm-migration)
const addAjvFormats =
    typeof _addAjvFormats === "function" ? _addAjvFormats : _addAjvFormats.default;

// NOTE(calebmer, #public-api): The intent is to someday expose `ApiService` as
// our public API. For now it's only used by our AI agent bots. As we work on
// `ApiService` we'll leave comments with #public-api for anything we want to
// revisit when preparing for public launch of the API.

const apiSpecificationPath = joinPath(
    runfilesPath,
    "cyberworlds/shared/api/api_specification_final.yaml",
);

export async function createApiServiceServer(
    processContext: ApiServiceProcessContext,
    paths: ApiPathsBase,
    {
        shutdownManager,
        edgeServiceUrl,
        resourceServiceUrl,
        tokenAgent,
    }: {
        shutdownManager: ShutdownManager;
        edgeServiceUrl: string;
        resourceServiceUrl: string;
        tokenAgent: TokenAgent;
    },
) {
    const requestListener = await createApiServiceRequestListener(processContext, paths, {
        edgeServiceUrl,
        resourceServiceUrl,
        tokenAgent,
    });

    return createStandardizedServerBase(
        processContext.tracer.getRoot(),
        shutdownManager,
        requestListener,
    );
}

export async function createApiServiceRequestListener(
    processContext: ApiServiceProcessContext,
    paths: ApiPathsBase,
    {
        edgeServiceUrl,
        resourceServiceUrl,
        tokenAgent,
    }: {
        edgeServiceUrl: string;
        resourceServiceUrl: string;
        tokenAgent: TokenAgent;
    },
) {
    if (!processContext.languageModel && !import.meta.jest) {
        throw new InternalError("Missing language model in context");
    }

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

    function createRequestListener(
        route: string,
        action: (
            span: TracerSpan,
            request: Request,
            url: URL,
            pathParameters: {[key: string]: string | number | undefined},
        ) => Promise<Response>,
    ) {
        return (
            req: IncomingMessage,
            res: ServerResponse<IncomingMessage>,
            pathParameters: {[key: string]: string | number | undefined},
        ) => {
            standardizedRequestListener(tracer, req, res, async request => {
                const url = new URL(request.url);

                // TODO(calebmer, #public-api): `traceServerResponse()` looks for the
                // `cyberworlds-tracer-propagation-context` to continue a request trace.
                // Ideally we wouldn't respect this header from public API calls (only from
                // internal API calls) since it would allow public API users to mess with our
                // traces (though maybe it's not an issue since what's the use case for that?).
                return traceServerResponse(tracer, request, url, route, async (span, request) => {
                    let isHtmlRequest = false;

                    if (request.headers.has("accept")) {
                        const negotiator = new Negotiator(req);
                        const negotiatedMediaType = negotiator.mediaType([
                            "text/html",
                            "application/json",
                        ]);

                        isHtmlRequest = negotiatedMediaType === "text/html";
                    }

                    // If the request doesn't have an `Authorization` header but does have a
                    // `Cookie` header and this is a browser requesting HTTP then create a new
                    // `Request` object where the cookie named `authorization` is used as the
                    // `Authorization` header.
                    if (isHtmlRequest && !request.headers.has("authorization")) {
                        const cookieHeader = request.headers.get("cookie");
                        if (cookieHeader) {
                            const authorizationCookie =
                                parseCookieHeader(cookieHeader)["authorization"];

                            if (authorizationCookie) {
                                const headers = new Headers(request.headers);
                                headers.delete("cookie");
                                headers.set("authorization", authorizationCookie);

                                request = new Request(request.url, {
                                    method: request.method,
                                    headers,
                                    body: request.body,
                                    signal: request.signal,
                                });
                            }
                        }
                    }

                    const response = await action(span, request, url, pathParameters);

                    if (isHtmlRequest) {
                        return renderApiBrowser({
                            request,
                            response,
                            resourceServiceUrl,
                            url,
                            route,
                        });
                    }

                    return response;
                });
            });
        };
    }

    const defaultRequestListener = createRequestListener("/*", async () => {
        return createApiErrorResponse({
            status: 404,
            message: "Path not found.",
            isRetryable: false,
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

    router.on("GET", "/healthcheck", (req, res) => {
        standardizedRequestListener(tracer, req, res, async request => {
            const url = new URL(request.url);
            return traceServerResponse(
                tracer,
                request,
                url,
                "/healthcheck",
                async () =>
                    new Response("200 OK", {
                        status: 200,
                        headers: {"content-type": "text/plain"},
                    }),
            );
        });
    });

    const ajv = new Ajv({strict: false});

    // Support formats like `date-time` from the OpenAPI specification.
    addAjvFormats(ajv);

    const ajvSharedSchemaName = "shared.yaml";

    ajv.addSchema(
        // Ajv supports `discriminator.propertyName` but not `discriminator.mapping`.
        // So remove `discriminator.mapping` from our schema. Ajv uses
        // `discriminator.propertyName` purely as an optimization and expects
        // discriminator schemas to have constant property names at
        // `discriminator.propertyName`.
        //
        // `api_specification.test.ts` makes sure our usage of `discriminator` is
        // consistent and compatible with Ajv.
        removeDiscriminatorMappingForAjv(apiSpecification as any) as any,
        ajvSharedSchemaName,
    );

    function removeDiscriminatorMappingForAjv(value: JsonValue): JsonValue {
        if (!isObject(value)) return value;
        if (isReadonlyArray(value)) return value.map(removeDiscriminatorMappingForAjv);

        return mapObjectValues(value, (keyValue, key) =>
            key !== "mapping" && keyValue !== undefined
                ? removeDiscriminatorMappingForAjv(keyValue)
                : undefined,
        );
    }

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

        // Convert path parameters from the OpenAPI format (`/hello/{name}`) to the
        // `find-my-way` format (`/hello/:name`). Right now we only support path
        // parameters that are an entire path segment. Paths like `/report.{format}`
        // aren't currently accepted.
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

        const firstValidOpenApiMethod = assertExists(
            Object.values(OpenAPIV3.HttpMethods).find(
                openApiMethod => !!openApiPathItem[openApiMethod],
            ) ?? null,
        );
        const firstValidFindMyWayMethod =
            firstValidOpenApiMethod.toUpperCase() as FindMyWay.HTTPMethod;

        for (const openApiMethod of Object.values(OpenAPIV3.HttpMethods)) {
            const findMyWayMethod = openApiMethod.toUpperCase() as FindMyWay.HTTPMethod;

            installRoute({
                openApiPath,
                openApiPathItem,
                openApiMethod,
                findMyWayPath,
                findMyWayMethod,
                firstValidFindMyWayMethod,
            });
        }
    }

    function installRoute({
        openApiPath,
        openApiPathItem,
        openApiMethod,
        findMyWayPath,
        findMyWayMethod,
        firstValidFindMyWayMethod,
    }: {
        openApiPath: string;
        openApiPathItem: OpenAPIV3.PathItemObject;
        openApiMethod: OpenAPIV3.HttpMethods;
        findMyWayPath: string;
        findMyWayMethod: FindMyWay.HTTPMethod;
        firstValidFindMyWayMethod: FindMyWay.HTTPMethod;
    }) {
        const openApiOperation = openApiPathItem[openApiMethod];

        const parameters = [
            ...(openApiPathItem.parameters ?? emptyArray),
            ...(openApiOperation?.parameters ?? emptyArray),
        ];

        const pathParametersSchema = {
            type: "object",
            properties: cast<{
                [key: string]: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
            }>({}),
            required: cast<Array<string>>([]),
            additionalProperties: false,
        } as const;

        const queryParametersSchema = {
            type: "object",
            properties: cast<{
                [key: string]: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
            }>({}),
            required: cast<Array<string>>([]),
            additionalProperties: false,
        } as const;

        const pathParameterDefinitions = new Map<string, {type: "integer" | "number" | "string"}>();

        const queryParameterDefinitions = new Map<
            string,
            {type: "integer" | "number" | "string" | "array"}
        >();

        for (let parameter of parameters) {
            parameter = resolveReference(parameter);

            switch (parameter.in) {
                case "path": {
                    assert(parameter.schema);
                    assert(!pathParametersSchema.properties[parameter.name]);

                    pathParametersSchema.properties[parameter.name] = parameter.schema;
                    if (parameter.required) pathParametersSchema.required.push(parameter.name);

                    const parameterSchema = resolveReference(parameter.schema);

                    pathParameterDefinitions.set(parameter.name, {
                        type:
                            parameterSchema.type === "integer" || parameterSchema.type === "number"
                                ? parameterSchema.type
                                : "string",
                    });
                    break;
                }
                case "query": {
                    assert(parameter.schema);
                    assert(!queryParametersSchema.properties[parameter.name]);

                    queryParametersSchema.properties[parameter.name] = parameter.schema;
                    if (parameter.required) queryParametersSchema.required.push(parameter.name);

                    const parameterSchema = resolveReference(parameter.schema);

                    queryParameterDefinitions.set(parameter.name, {
                        type:
                            parameterSchema.type === "integer" ||
                            parameterSchema.type === "number" ||
                            parameterSchema.type === "array"
                                ? parameterSchema.type
                                : "string",
                    });
                    break;
                }
                default:
                    throw new InternalError(quote`Unexpected parameter location: ${parameter.in}`);
            }
        }

        const validatePathParameters = compileWithAjv(pathParametersSchema);
        const validateQueryParameters = compileWithAjv(queryParametersSchema);

        const validateRequestBody = openApiOperation?.requestBody
            ? compileWithAjv(
                  assertExists(
                      resolveReference(openApiOperation.requestBody).content?.["application/json"]
                          ?.schema,
                  ),
              )
            : null;

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

        const executeOperation = paths[openApiPath]?.[openApiMethod];

        async function requestListener(
            span: TracerSpan,
            request: Request,
            url: URL,
            pathParameters: {[key: string]: string | number | undefined},
        ) {
            const context = processContext.clone({
                tracer: new TracerContextModule(span),
                cache: CacheContextModule.new(),
                batch: BatchContextModule.new(),
            });

            try {
                /* ========================================================================== *\
                 *                               Authorization                                *
                \* ========================================================================== */

                const authorizationHeader = request.headers.get("Authorization");
                if (authorizationHeader === null) {
                    return createApiErrorResponse({
                        status: 401,
                        message: "Missing `Authorization` header.",
                        isRetryable: false,
                    });
                }

                const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);
                if (authorizationHeaderMatch === null) {
                    return createApiErrorResponse({
                        status: 400,
                        message:
                            "Expected `Authorization` header to have `Bearer` authentication scheme.",
                        isRetryable: false,
                    });
                }

                const [apiKey = "", accessToken] = (authorizationHeaderMatch[1] ?? "").split(
                    // A valid non-base64 character according to:
                    // https://datatracker.ietf.org/doc/html/rfc6750#section-2.1
                    "~",
                    2,
                );

                if (!isApiKey(apiKey)) {
                    return createApiErrorResponse({
                        status: 400,
                        message: "Incorrectly formatted API key in `Authorization` header.",
                        isRetryable: false,
                    });
                }

                const [apiKeyAttributes, accessTokenPayloadResult] = await runAllPromises([
                    // Check if the caller provided a valid API key. If this function returns a
                    // non-null object then the caller has successfully authenticated and we'll
                    // execute their request.
                    getApiKeyAttributesIfExists(context, apiKey, {
                        consistency: "Eventual",
                    }).then(apiKeyAttributes => {
                        if (apiKeyAttributes) return apiKeyAttributes;

                        // If we couldn't find the API key with eventual consistency, try again with
                        // strong consistency. In case the API key was just created and there's some
                        // DynamoDB eventual consistency lag.
                        return getApiKeyAttributesIfExists(context, apiKey, {
                            consistency: "Strong",
                        });
                    }),

                    (async (): Promise<Result<BotTokenPayload | null, Response>> => {
                        if (accessToken === undefined) return {ok: true, value: null};

                        let accessTokenPayload: TokenPayload;

                        try {
                            ({payload: accessTokenPayload} =
                                await tokenAgent.publicSide.verifyToken(accessToken));
                        } catch (error) {
                            if (!(error instanceof PermissionDeniedError)) throw error;

                            let message: string;

                            // Include extra details for well known errors. This is mostly so tests can
                            // confirm they're exercising the right error case.
                            switch (error.message) {
                                case "signature verification failed":
                                    message =
                                        "Access token in `Authorization` header failed signature verification.";
                                    break;
                                // eslint-disable-next-line string-quotes
                                case 'unexpected "aud" claim value':
                                    message =
                                        "Access token in `Authorization` header has an incorrect audience.";
                                    break;
                                // eslint-disable-next-line string-quotes
                                case '"exp" claim timestamp check failed':
                                    message = "Access token in `Authorization` header has expired.";
                                    break;
                                default:
                                    message = "Invalid access token in `Authorization` header.";
                                    break;
                            }

                            return {
                                ok: false,
                                error: createApiErrorResponse({
                                    status: 403,
                                    message,
                                    isRetryable: false,
                                }),
                            };
                        }

                        // Only bot actors are allowed to make API requests. So our access token should
                        // be from `JobQueueService` (which calls our webhooks) and should be for a bot
                        // actor. Otherwise we don't accept the token.
                        if (accessTokenPayload.type !== "Bot") {
                            return {
                                ok: false,
                                error: createApiErrorResponse({
                                    status: 403,
                                    message: "Expected bot access token in `Authorization` header.",
                                    isRetryable: false,
                                }),
                            };
                        }

                        return {ok: true, value: accessTokenPayload};
                    })(),
                ]);

                // If we couldn't verify the access token, return the error response.
                if (!accessTokenPayloadResult.ok) return accessTokenPayloadResult.error;
                const accessTokenPayload = accessTokenPayloadResult.value;

                if (!apiKeyAttributes) {
                    return createApiErrorResponse({
                        status: 403,
                        message: "Unrecognized API key in `Authorization` header.",
                        isRetryable: false,
                    });
                }

                let spaceId: SpaceId;
                let accountId: AccountId;
                let scope: BotTokenPayloadScope;

                if (apiKeyAttributes.space === null) {
                    if (accessTokenPayload === null) {
                        return createApiErrorResponse({
                            status: 403,
                            message:
                                "Missing access token for unscoped API key in `Authorization` header.",
                            isRetryable: false,
                        });
                    } else {
                        spaceId = accessTokenPayload.spaceId;
                        accountId = accessTokenPayload.accountId;
                        scope = accessTokenPayload.scope;
                    }
                } else {
                    if (accessTokenPayload !== null) {
                        return createApiErrorResponse({
                            status: 403,
                            message:
                                "Can’t have both an access token and a scoped API key in `Authorization` header.",
                            isRetryable: false,
                        });
                    } else {
                        spaceId = apiKeyAttributes.space.spaceId;
                        accountId = apiKeyAttributes.space.accountId;
                        scope = apiKeyAttributes.space.scope;
                    }
                }

                const [isMemberOfSpace, botId] = await runAllPromises([
                    // `isAccountMemberOfSpaceWithoutAuthorization()` and
                    // `getSpaceAccountBotIdIfExistsWithoutAuthorization()` use the same caches so
                    // we should only need to make one database request to answer both.
                    isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId),
                    getSpaceAccountBotIdIfExistsWithoutAuthorization(context, spaceId, accountId),
                ]);

                if (apiKeyAttributes.botId !== botId) {
                    return createApiErrorResponse({
                        status: 403,
                        message:
                            "Access token bot account isn’t an instantiation of the API key bot in `Authorization` header.",
                        isRetryable: false,
                    });
                }

                if (!isMemberOfSpace) {
                    return createApiErrorResponse({
                        status: 403,
                        message: "Bot account was removed from space.",
                        isRetryable: false,
                    });
                }

                const contextWithActor = context.clone({
                    // We expect all reads from the API service to use strong consistency. We don't
                    // want to expose the technical complexity of strong vs eventual consistency to
                    // our API end users. So we always use strong consistency.
                    dynamo: context.dynamo.expectStrongReadConsistencyReturningModule(),

                    // We’ve validated the caller's API key and access token. Let them make a
                    // request with a bot actor!
                    actor: BotActorContextModule.dangerouslyNew(
                        "ApiService",
                        spaceId,
                        accountId,
                        scope,
                    ),
                });

                /* ========================================================================== *\
                 *                                 Validation                                 *
                \* ========================================================================== */

                // Parse any integer/number path parameters before validating.
                for (const [parameterName, parameterDefinition] of pathParameterDefinitions) {
                    const pathParameter = pathParameters[parameterName];

                    switch (parameterDefinition.type) {
                        case "integer": {
                            if (typeof pathParameter === "string")
                                pathParameters[parameterName] = parseInt(pathParameter, 10);
                            break;
                        }
                        case "number": {
                            if (typeof pathParameter === "string")
                                pathParameters[parameterName] = parseFloat(pathParameter);
                            break;
                        }
                    }
                }

                const queryParameters: {[key: string]: unknown} = {};

                for (const [parameterName, parameterDefinition] of queryParameterDefinitions) {
                    const queryParameter = url.searchParams.get(parameterName);
                    if (queryParameter === null) continue;

                    switch (parameterDefinition.type) {
                        case "integer": {
                            queryParameters[parameterName] = parseInt(queryParameter, 10);
                            break;
                        }
                        case "number": {
                            queryParameters[parameterName] = parseFloat(queryParameter);
                            break;
                        }
                        case "string": {
                            queryParameters[parameterName] = queryParameter;
                            break;
                        }
                        case "array": {
                            const arrayParams = url.searchParams.getAll(parameterName);
                            queryParameters[parameterName] = arrayParams.flatMap(item =>
                                item.split(","),
                            );
                            break;
                        }
                        default:
                            throw exhaustive(parameterDefinition.type);
                    }
                }

                const arePathParametersValid = validatePathParameters(pathParameters);
                if (!arePathParametersValid) {
                    const propertyName = findMapIterable(
                        validatePathParameters.errors ?? emptyArray,
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
                        isRetryable: false,
                    });
                }

                const areQueryParametersValid = validateQueryParameters(queryParameters);
                if (!areQueryParametersValid) {
                    const propertyName = findMapIterable(
                        validateQueryParameters.errors ?? emptyArray,
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
                            ? quote`Invalid ${propertyName} query parameter.`
                            : "Invalid query parameters.",
                        isRetryable: false,
                    });
                }

                if (executeOperation === undefined) {
                    return createApiErrorResponse({
                        status: 405,
                        message: quote`${findMyWayMethod} method isn’t supported, try ${firstValidFindMyWayMethod}.`,
                        isRetryable: false,
                    });
                }

                let requestBody: any = null;

                if (validateRequestBody !== null) {
                    requestBody = await request.json();

                    const valid = validateRequestBody(requestBody);
                    if (!valid) {
                        const instancePath = validateRequestBody.errors?.[0]?.instancePath;

                        return createApiErrorResponse({
                            status: 400,
                            message: `Invalid request body${
                                instancePath ? quote` (path: ${"#" + instancePath})` : ""
                            }.`,
                            isRetryable: false,
                        });
                    }
                }

                /* ========================================================================== *\
                 *                                 Execution                                  *
                \* ========================================================================== */

                const {content} = await executeOperation(contextWithActor, {
                    pathParameters,
                    queryParameters,
                    url,
                    headers: request.headers,
                    requestBody,
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
                    isRetryable: isTransientError(error),
                });
            }
        }

        router.on(
            findMyWayMethod,
            findMyWayPath,
            createRequestListener(findMyWayPath, requestListener),
        );
    }

    return (req: IncomingMessage, res: ServerResponse<IncomingMessage>): void => {
        router.lookup(req, res);
    };
}

function createApiErrorResponse({
    status,
    message,
    isRetryable,
    stack,
}: {
    status: number;
    message: string;
    isRetryable: boolean;
    stack?: string;
}) {
    const body = cast<
        ApiSpecification.components["responses"]["Error"]["content"]["application/json"] & {
            error: {stack?: string};
        }
    >({
        error: {
            message,
            retry: {
                able: isRetryable,
            },

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
