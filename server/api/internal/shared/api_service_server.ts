import {parseDate, today} from "@internationalized/date";
import {Ajv, ErrorObject} from "ajv";
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
import {getApiKeyAttributesIfExists} from "~/server/bots/get_api_key_attributes_if_exists.js";
import {BotActorContextModule} from "~/server/helpers/actor_context_module.js";
import {createSimpleOkResponse} from "~/server/helpers/create_simple_ok_response.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    createStandardizedServerBase,
    standardizedRequestListener,
} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {getSpaceAccountBotIdIfExistsWithoutAuthorization} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {BotTokenPayload, TokenPayload} from "~/server/tokens/token_payload.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.open_source.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {ErrorCode} from "~/shared/error/error_code.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.open_source.js";
import {isTransientError} from "~/shared/error/is_transient_error.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {isFileContentType} from "~/shared/files/file_content_type.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.open_source.js";
import {isApiKey} from "~/shared/id/api_key.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// Node.js ESM interop (#node-esm-migration)
const addAjvFormats =
    typeof _addAjvFormats === "function" ? _addAjvFormats : _addAjvFormats.default;

// NOTE(calebmer, #public-api): The intent is to someday expose `ApiService` as our
// public API. For now it's only used by our AI agent bots. As we work on
// `ApiService` we'll leave comments with #public-api for anything we want to
// revisit when preparing for public launch of the API.

const apiSpecificationPath = joinPath(
    runfilesPath,
    "cyberworlds/shared/api/specification/api_specification_final.yaml",
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
    if (!processContext.languageModels?.getEmbeddingModelKey() && !import.meta.jest) {
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
                // `cyberworlds-tracer-propagation-context` to continue a request trace. Ideally we
                // wouldn't respect this header from public API calls (only from internal API
                // calls) since it would allow public API users to mess with our traces (though
                // maybe it's not an issue since what's the use case for that?).
                return await traceServerResponse(
                    tracer,
                    request,
                    url,
                    route,
                    async (span, request) => {
                        let isHtmlRequest = false;

                        if (request.headers.has("accept")) {
                            const negotiator = new Negotiator(req);
                            const negotiatedMediaType = negotiator.mediaType([
                                "application/json",
                                "text/html",
                            ]);

                            isHtmlRequest = negotiatedMediaType === "text/html";
                        }

                        // If the request doesn't have an `Authorization` header but does have a `Cookie`
                        // header and this is a browser requesting HTTP then create a new `Request` object
                        // where the cookie named `authorization` is used as the `Authorization` header.
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
                            return await renderApiBrowser({
                                request,
                                response,
                                resourceServiceUrl,
                                url,
                                route,
                            });
                        }

                        return response;
                    },
                );
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

                return await traceServerResponse(tracer, request, url, redirectPath, async () => {
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
            return await traceServerResponse(tracer, request, url, "/healthcheck", async () =>
                createSimpleOkResponse(),
            );
        });
    });

    router.on("GET", "/specification.yaml", (req, res) => {
        standardizedRequestListener(tracer, req, res, async request => {
            const url = new URL(request.url);
            return await traceServerResponse(
                tracer,
                request,
                url,
                "/specification.yaml",
                async () =>
                    new Response(apiSpecificationString, {
                        status: 200,
                        headers: {"content-type": "application/yaml"},
                    }),
            );
        });
    });

    const ajvSharedSchemaName = "shared.yaml";
    const ajv = createAjv({validateObjectKeyOrder: false});

    const debugResponseAjv =
        process.env.NODE_ENV !== "production" ? createAjv({validateObjectKeyOrder: true}) : null;

    function createAjv({validateObjectKeyOrder}: {validateObjectKeyOrder: boolean}) {
        const ajv = new Ajv({strict: false});

        if (validateObjectKeyOrder) {
            ajv.addKeyword({
                keyword: objectPropertyOrderKeyword,
                type: "object",
                schemaType: "array",
                errors: true,
                validate: validateObjectPropertyOrderForAjv,
            });
        }

        // Support formats like `date-time` from the OpenAPI specification.
        addAjvFormats(ajv);

        ajv.addSchema(
            // Ajv supports `discriminator.propertyName` but not `discriminator.mapping`. So
            // remove `discriminator.mapping` from our schema. Ajv uses
            // `discriminator.propertyName` purely as an optimization and expects discriminator
            // schemas to have constant property names at `discriminator.propertyName`.
            //
            // `api_specification.test.ts` makes sure our usage of `discriminator` is
            // consistent and compatible with Ajv.
            prepareSchemaForAjv(apiSpecification as any, {validateObjectKeyOrder}) as any,
            ajvSharedSchemaName,
        );

        return ajv;
    }

    function prepareSchemaForAjv(
        value: JsonValue,
        {validateObjectKeyOrder}: {validateObjectKeyOrder: boolean},
    ): JsonValue {
        if (!isObject(value)) return value;

        if (isReadonlyArray(value)) {
            return value.map(value => prepareSchemaForAjv(value, {validateObjectKeyOrder}));
        }

        let result = mapObjectValues(value, (keyValue, key) =>
            key !== "mapping" && keyValue !== undefined
                ? prepareSchemaForAjv(keyValue, {validateObjectKeyOrder})
                : undefined,
        );

        if (validateObjectKeyOrder && result.type === "object" && isObject(result.properties)) {
            result = {
                ...result,
                [objectPropertyOrderKeyword]: Object.keys(result.properties),
            };
        }

        return result;
    }

    function compileWithAjv(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject) {
        return actuallyCompileWithAjv(ajv, schema, {validateObjectKeyOrder: false});
    }

    function compileDebugResponseWithAjv(
        schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
    ) {
        assert(debugResponseAjv);

        return actuallyCompileWithAjv(debugResponseAjv, schema, {
            validateObjectKeyOrder: true,
        });
    }

    function actuallyCompileWithAjv(
        ajv: Ajv,
        schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
        {validateObjectKeyOrder}: {validateObjectKeyOrder: boolean},
    ) {
        schema = updateRefsForAjv(
            prepareSchemaForAjv(schema as JsonValue, {validateObjectKeyOrder}),
        ) as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;

        return ajv.compile(schema);
    }

    function updateRefsForAjv(value: JsonValue): JsonValue {
        if (isReadonlyArray(value)) {
            return value.map(updateRefsForAjv);
        } else if (isObject(value)) {
            // In order to reference component schemas in the OpenAPI specification, we can't
            // reference relative paths and instead need to reference an absolute path created
            // for AJV.
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
        if (openApiPath === "/specification.yaml") continue;

        // Convert path parameters from the OpenAPI format (`/hello/{name}`) to the
        // `find-my-way` format (`/hello/:name`). Parameters may have a static suffix, as
        // in `/tasks/{id}-with-notes`, but must begin their path segment.
        const findMyWayPath = openApiPath
            .split("/")
            .map(pathSegment => {
                if (!pathSegment.startsWith("{")) {
                    assert(!/[{}]/.test(pathSegment));
                    return pathSegment;
                }

                const match = assertExists(pathSegment.match(/^\{([^}]+)\}([^{}]*)$/));
                const [, pathParamName = "", staticSuffix = ""] = match;
                assert(isIdentifier(pathParamName));

                return `:${pathParamName}${staticSuffix}`;
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

        // In development and test environments, we validate that the API response matches
        // what's in our OpenAPI schema. In production for performance we don't validate
        // and assume our code is correct.
        const debugValidateResponseJsonContentByStatus =
            process.env.NODE_ENV !== "production" && openApiOperation?.responses
                ? mapObjectValues(openApiOperation.responses, response => {
                      response = resolveReference(response);
                      const jsonSchema = response.content?.["application/json"]?.schema;

                      if (!jsonSchema) {
                          // Verify non-JSON responses have a known content type or no content at all (like a
                          // redirect).
                          const contentTypes = response.content
                              ? Object.keys(response.content)
                              : [];

                          assert(
                              contentTypes.length === 0 ||
                                  contentTypes.every(
                                      contentType =>
                                          contentType !== "application/json" &&
                                          isFileContentType(contentType),
                                  ),
                          );

                          return null;
                      }

                      return compileDebugResponseWithAjv(jsonSchema);
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
                 *                                 Versioning                                 *
                \* ========================================================================== */

                const currentDate = today(defaultTimeZone);

                const versionHeader = request.headers.get("Alpine-Version");
                if (versionHeader === null) {
                    throw new InvalidArgumentError("Missing `Alpine-Version` header", {
                        displayMessage: errorDisplayMessage`Missing \`Alpine-Version\` header. When starting a new project, you should set the \`Alpine-Version\` header to today\u2019s date: \`${currentDate.toString()}\`. Don\u2019t dynamically compute the \`Alpine-Version\` header from today\u2019s date or your code may be broken by backwards incompatible API changes.`,
                    });
                }

                const version = parseDate(versionHeader);

                if (version.compare(currentDate.add({days: 1})) > 0) {
                    throw new InvalidArgumentError("Invalid `Alpine-Version` header", {
                        displayMessage: errorDisplayMessage`Can\u2019t set the \`Alpine-Version\` header to a future date. When starting a new project, you should set the \`Alpine-Version\` header to today\u2019s date: \`${currentDate.toString()}\`. Don\u2019t dynamically compute the \`Alpine-Version\` header from today\u2019s date or your code may be broken by backwards incompatible API changes.`,
                    });
                }

                // TODO(calebmer): Eventually we'll have more than one API version. At that point,
                // my rough idea is we'll have multiple `api_specification.yaml`s and we'll have
                // translation middleware. The translation middleware will be responsible for
                // making a request to the new version of the API and translating it back to an
                // older version of the API. (My understanding is this is how Stripe implements API
                // versioning on their backend.)
                //
                // My concept here is we'll have a single file like
                // `api_middleware_2027_04_30_to_2026_07_12.ts` which looks like:
                //
                // ```ts
                // export const middleware = {
                //     // For all paths:
                //     "/documents/{id}": {
                //         get: async (context, request, next) => {
                //             // Manipulate `request`...
                //
                //             const response = await next.get("/documents/{id}", request);
                //
                //             // Manipulate `response`...
                //
                //             return response;
                //         },
                //     },
                // };
                // ```
                //
                // `next` is a way to make a request against against the _next_ version of the API.
                // So we only ever need to write middleware between two versions. From there we
                // should be able to safely implement an old request shape by sending a request
                // through multiple layers of middleware.

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
                    throw new InvalidArgumentError("Invalid `Authorization` header", {
                        displayMessage: errorDisplayMessage`Expected \`Authorization\` header to have \`Bearer\` authentication scheme.`,
                    });
                }

                const [apiKey = "", accessToken] = (authorizationHeaderMatch[1] ?? "").split(
                    // A valid non-base64 character according to:
                    // https://datatracker.ietf.org/doc/html/rfc6750#section-2.1
                    "~",
                    2,
                );

                if (!isApiKey(apiKey)) {
                    throw new InvalidArgumentError("Invalid `Authorization` header", {
                        displayMessage: errorDisplayMessage`Incorrectly formatted API key in \`Authorization\` header.`,
                    });
                }

                const [apiKeyAttributes, accessTokenPayloadResult] = await runAllPromises([
                    // Check if the caller provided a valid API key. If this function returns a
                    // non-null object then the caller has successfully authenticated and we'll execute
                    // their request.
                    getApiKeyAttributesIfExists(context, apiKey, {
                        consistency: "Eventual",
                    }).then(apiKeyAttributes => {
                        if (apiKeyAttributes) return apiKeyAttributes;

                        // If we couldn't find the API key with eventual consistency, try again with strong
                        // consistency. In case the API key was just created and there's some DynamoDB
                        // eventual consistency lag.
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

                            // Include extra details for well known errors. This is mostly so tests can confirm
                            // they're exercising the right error case.
                            switch (error.message) {
                                case "signature verification failed":
                                    message =
                                        "Access token in `Authorization` header failed signature verification.";
                                    break;
                                // eslint-disable-next-line cyberworlds/string-quotes
                                case 'unexpected "aud" claim value':
                                    message =
                                        "Access token in `Authorization` header has an incorrect audience.";
                                    break;
                                // eslint-disable-next-line cyberworlds/string-quotes
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

                        // Only bot actors are allowed to make API requests. So our access token should be
                        // from `JobQueueService` (which calls our webhooks) and should be for a bot actor.
                        // Otherwise we don't accept the token.
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
                let scope: BotTokenScope;

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
                                "Can\u2019t have both an access token and a scoped API key in `Authorization` header.",
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
                    // `getSpaceAccountBotIdIfExistsWithoutAuthorization()` use the same caches so we
                    // should only need to make one database request to answer both.
                    isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId),
                    getSpaceAccountBotIdIfExistsWithoutAuthorization(context, spaceId, accountId),
                ]);

                if (apiKeyAttributes.botId !== botId) {
                    return createApiErrorResponse({
                        status: 403,
                        message:
                            "Access token bot account isn\u2019t an instantiation of the API key bot in `Authorization` header.",
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
                    // want to expose the technical complexity of strong vs eventual consistency to our
                    // API end users. So we always use strong consistency.
                    dynamo: context.dynamo.expectStrongReadConsistencyReturningModule(),

                    // We've validated the caller's API key and access token. Let them make a request
                    // with a bot actor!
                    actor: BotActorContextModule.dangerouslyNew(
                        "ApiService",
                        spaceId,
                        accountId,
                        scope,
                    ),
                });

                // Add propagated data identifying the bot actor.
                span.addPropagatedData(contextWithActor.actor.getPropagatedData());

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

                    throw new InvalidArgumentError("Invalid path parameter", {
                        displayMessage: propertyName
                            ? errorDisplayMessage`Invalid ${errorDisplayMessage([quote(propertyName)])} path parameter.`
                            : errorDisplayMessage`Invalid path parameters.`,
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

                    throw new InvalidArgumentError("Invalid query parameter", {
                        displayMessage: propertyName
                            ? errorDisplayMessage`Invalid ${errorDisplayMessage([quote(propertyName)])} query parameter.`
                            : errorDisplayMessage`Invalid query parameters.`,
                    });
                }

                if (executeOperation === undefined) {
                    return createApiErrorResponse({
                        status: 405,
                        message: quote`${findMyWayMethod} method isn\u2019t supported, try ${firstValidFindMyWayMethod}.`,
                        isRetryable: false,
                    });
                }

                let requestBody: any = null;

                if (validateRequestBody !== null) {
                    requestBody = await request.json();

                    const valid = validateRequestBody(requestBody);
                    if (!valid) {
                        const instancePath = validateRequestBody.errors?.[0]?.instancePath;

                        throw new InvalidArgumentError("Invalid request body", {
                            displayMessage: errorDisplayMessage`Invalid request body${errorDisplayMessage([instancePath ? quote` (path: ${"#" + instancePath})` : ""])}.`,
                        });
                    }
                }

                /* ========================================================================== *\
                 *                                 Execution                                  *
                \* ========================================================================== */

                const operationResult = await executeOperation(contextWithActor, {
                    pathParameters,
                    queryParameters,
                    url,
                    headers: request.headers,
                    requestBody,
                    span,
                });

                if (hasOwnProperty(operationResult, "response")) {
                    return operationResult.response;
                }

                const {content} = operationResult;

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
                if (!(error instanceof ErrorBase) || error.displayMessage === undefined) {
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
                    stack:
                        isObject(error) && "stack" in error && typeof error.stack === "string"
                            ? error.stack
                            : undefined,
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

const objectPropertyOrderKeyword = "x-propertyOrder";

function validateObjectPropertyOrderForAjv(expectedPropertyOrder: unknown, data: unknown) {
    assert(isReadonlyArray(expectedPropertyOrder));
    assert(isObject(data));

    const expectedPropertyIndexByName = new Map<string, number>();

    for (let index = 0; index < expectedPropertyOrder.length; index++) {
        const propertyName = expectedPropertyOrder[index];
        assert(typeof propertyName === "string");
        expectedPropertyIndexByName.set(propertyName, index);
    }

    let previousPropertyIndex = -1;
    let previousPropertyName: string | undefined;

    for (const propertyName of Object.keys(data)) {
        const propertyIndex = expectedPropertyIndexByName.get(propertyName);
        if (propertyIndex === undefined) continue;

        if (propertyIndex < previousPropertyIndex) {
            validateObjectPropertyOrderForAjv.errors = [
                {
                    keyword: objectPropertyOrderKeyword,
                    params: {
                        previousPropertyName,
                        propertyName,
                    },
                    message: quote`must list ${propertyName} before ${previousPropertyName}`,
                },
            ];

            return false;
        }

        previousPropertyIndex = propertyIndex;
        previousPropertyName = propertyName;
    }

    validateObjectPropertyOrderForAjv.errors = undefined;

    return true;
}

validateObjectPropertyOrderForAjv.errors = cast<Array<Partial<ErrorObject>> | undefined>(undefined);
