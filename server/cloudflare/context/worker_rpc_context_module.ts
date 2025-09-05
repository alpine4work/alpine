import {WorkerActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenPayload} from "~/server/tokens/token_payload.js";
import {BatchContextModule, ContextBatcherBase} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {deserializeRpcBatchResponse} from "~/shared/rpc/deserialize_rpc_batch_response.js";
import {
    RpcHttpBatchByActorCallInputSchema,
    RpcHttpBatchCallErrorOutputSchema,
    RpcHttpBatchCallInputSchema,
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {printSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Executes an RPC from our edge service.
 */
export class WorkerRpcContextModule extends RpcContextModuleBase<{
    tracer: TracerContextModule;
    actor: WorkerActorContextModule;
    batch: BatchContextModule;
}> {
    private readonly _batcher: WorkerRpcContextBatcher;

    constructor(batcher: WorkerRpcContextBatcher) {
        super();
        this._batcher = batcher;
    }

    public execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output> {
        return this._context.tracer.withSpan(`RPC ${definition.name}`, async (context, span) => {
            let tokenPayload: TokenPayload;
            switch (context.actor.type) {
                case "Session": {
                    tokenPayload = {
                        type: "Session",
                        sessionId: context.actor.getSessionId(),
                        accountId: context.actor.getAccountId(),
                    };
                    break;
                }
                case "System": {
                    tokenPayload = {
                        type: "System",
                        spaceId: context.actor.getSpaceId(),
                    };
                    break;
                }
                case "Anonymous": {
                    tokenPayload = {
                        type: "Anonymous",
                    };
                    break;
                }
                case "Bot": {
                    tokenPayload = {
                        type: "Bot",
                        spaceId: context.actor.getSpaceId(),
                        accountId: context.actor.getBotAccountId(),
                        scope: context.actor.getScope(),
                    };
                    break;
                }
                default:
                    throw exhaustive(context.actor);
            }

            const serializedInput = definition.inputSchema.serialize(input);

            const serializedOutput = await this._context.batch.execute(this._batcher, {
                tokenPayload,
                name: definition.name,
                input: serializedInput,
                span,
            });

            return definition.outputSchema.deserialize(serializedOutput);
        });
    }

    public fork(): WorkerRpcContextModule {
        return new WorkerRpcContextModule(this._batcher);
    }
}

type RpcCall = {
    readonly tokenPayload: TokenPayload;
    readonly name: string;
    readonly input: SchemaSerializedValue;
    readonly outputPromiseResolver: PromiseResolver<SchemaSerializedValue>;
    readonly span: TracerSpan;
};

export class WorkerRpcContextBatcher extends ContextBatcherBase<
    {},
    Array<RpcCall>,
    Omit<RpcCall, "outputPromiseResolver">,
    SchemaSerializedValue
> {
    // It's ok to share the batch when the actor changes because our batcher
    // specifically handles calls with different actors. By using the endpoint
    // `/api/rpc/_batchByActor` which accepts multiple authentication tokens.
    public override readonly whenActorChanges = "DangerouslyShare";

    private readonly _protocol: string;
    private readonly _host: string;
    private readonly _tokenAgent: TokenAgent;
    private readonly _cookieJar: CookieJar;

    constructor({
        protocol,
        host,
        tokenAgent,
        cookieJar,
    }: {
        protocol: string;
        host: string;
        tokenAgent: TokenAgent;
        cookieJar: CookieJar;
    }) {
        super();
        this._protocol = protocol;
        this._host = host;
        this._tokenAgent = tokenAgent;
        this._cookieJar = cookieJar;
    }

    public override newBatch() {
        return [];
    }

    public override addToBatch(
        callBatch: Array<RpcCall>,
        input: Omit<RpcCall, "outputPromiseResolver">,
    ): Promise<SchemaSerializedValue> {
        const outputPromiseResolver = createPromiseResolver<SchemaSerializedValue>();
        callBatch.push({...input, outputPromiseResolver});
        return outputPromiseResolver.promise;
    }

    public override executeBatch(context: Context<{}>, callBatch: Array<RpcCall>): void {
        const [firstCall, ...otherCalls] = callBatch;
        assert(firstCall);

        const tokenPayloads: Array<TokenPayload> = [];
        const actorIndexByTokenPayloadKey = new Map<string, number>();

        for (const call of callBatch) {
            const tokenPayloadKey = getTokenPayloadKey(call.tokenPayload);

            if (!actorIndexByTokenPayloadKey.has(tokenPayloadKey)) {
                actorIndexByTokenPayloadKey.set(tokenPayloadKey, tokenPayloads.length);
                tokenPayloads.push(call.tokenPayload);
            }
        }

        const spaceIdFromSpan = firstCall.span.getContextSpaceIdIfExists();

        (async () => {
            let route: string;
            let url: URL;

            const headers: {[key: string]: string} = {
                "content-type": "application/json",
                // As an optimization, include the space ID from our `TracerSpan` in RPC calls
                // which we'll use to authorize whether the current account has access to the
                // requested space.
                //
                // This does not provide any security guarantees! This is purely a performance
                // optimization to authorize the session and space access at once.
                ...(spaceIdFromSpan ? {"cyberworlds-space-id-hint": spaceIdFromSpan} : {}),
            };

            let body: unknown;

            if (otherCalls.length === 0) {
                route = "/api/rpc/:rpcName";
                url = new URL(`${this._protocol}//${this._host}/api/rpc/${firstCall.name}`);

                const token = await this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
                    "AppService",
                    firstCall.tokenPayload,
                );

                headers["authorization"] = `bearer ${token}`;

                body = RpcHttpCallInputSchema.serialize({
                    name: firstCall.name,
                    input: firstCall.input,
                });
            } else if (tokenPayloads.length === 1) {
                route = "/api/rpc/_batch";
                url = new URL(`${this._protocol}//${this._host}/api/rpc/_batch`);

                const token = await this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
                    "AppService",
                    tokenPayloads[0]!,
                );

                headers["authorization"] = `bearer ${token}`;

                body = RpcHttpBatchCallInputSchema.serialize({
                    calls: callBatch.map(call => ({
                        name: call.name,
                        input: call.input,
                        tracerContext: call.span.getPropagationContext(),
                    })),
                });
            } else {
                route = "/api/rpc/_batchByActor";
                url = new URL(`${this._protocol}//${this._host}/api/rpc/_batchByActor`);

                body = RpcHttpBatchByActorCallInputSchema.serialize({
                    actors: await runAllPromises(
                        tokenPayloads.map(async tokenPayload => {
                            const token =
                                await this._tokenAgent.privateSide.dangerouslySignShortLivedToken(
                                    "AppService",
                                    tokenPayload,
                                );

                            return {authorization: `bearer ${token}`};
                        }),
                    ),
                    calls: callBatch.map(call => ({
                        name: call.name,
                        input: call.input,
                        tracerContext: call.span.getPropagationContext(),
                        actorIndex: assertExists(
                            actorIndexByTokenPayloadKey.get(getTokenPayloadKey(call.tokenPayload)),
                        ),
                    })),
                });
            }

            await fetchWithTracer(
                firstCall.span,
                url,
                {
                    serviceName: "AppService",
                    route,
                    // When communicating via RPC, share cookies across requests. Particularly we
                    // care about the [AWS ALB sticky session cookies][1] which make sure requests
                    // from our Durable Object go to the same underlying host in AWS. That way
                    // caches in `AppService` work properly.
                    //
                    // [1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
                    cookieJar: this._cookieJar,
                    method: "POST",
                    headers,
                    body: JSON.stringify(body),
                },
                async (response, span) => {
                    // The first call is the parent of our HTTP execution. Link the other calls to
                    // the HTTP execution span so we can see the causal relationship.
                    for (const otherCall of otherCalls) {
                        otherCall.span.link(`Batch execution: ${span.getName()}`, span);
                    }

                    if (otherCalls.length === 0) {
                        const callOutput = await response
                            .json()
                            .then((output: any) => RpcHttpCallOutputSchema.deserialize(output))
                            .catch(error => {
                                // If we fail to parse the response body as JSON, classify as `Internal`
                                // status code.
                                //
                                // Maybe an error is also thrown here for some network errors? If so we should
                                // classify network errors as the `Unavailable` status code.
                                throw new InternalError(error.message, {cause: error});
                            });

                        if (!callOutput.ok) {
                            firstCall.outputPromiseResolver.reject(callOutput.error);
                        } else {
                            firstCall.outputPromiseResolver.resolve(callOutput.output);
                        }
                    } else if (!response.ok) {
                        const output = await response
                            .json()
                            .then((output: any) =>
                                RpcHttpBatchCallErrorOutputSchema.deserialize(output),
                            )
                            .catch(error => {
                                // If we fail to parse the response body as JSON, classify as `Internal`
                                // status code.
                                //
                                // Maybe an error is also thrown here for some network errors? If so we should
                                // classify network errors as the `Unavailable` status code.
                                throw new InternalError(error.message, {cause: error});
                            });

                        throw output.error;
                    } else {
                        await deserializeRpcBatchResponse(callBatch, response);
                    }
                },
            );
        })().catch(error => {
            let hasRejectedCall = false;

            for (const call of callBatch) {
                if (!call.outputPromiseResolver.isSettled()) {
                    hasRejectedCall = true;
                    call.outputPromiseResolver.reject(error);
                }
            }

            if (!hasRejectedCall) {
                scheduleUncaughtError(error);
            }
        });
    }
}

function getTokenPayloadKey(tokenPayload: TokenPayload): string {
    switch (tokenPayload.type) {
        case "Session":
            return `Session:${tokenPayload.sessionId}`;
        case "System":
            return `System:${tokenPayload.spaceId}`;
        case "Anonymous":
            return "Anonymous";
        case "Bot": {
            return `Bot:${tokenPayload.accountId}-${
                tokenPayload.scope.type === "Space"
                    ? "Space"
                    : printSearchDynamicEntityId(tokenPayload.scope)
            }`;
        }
        default:
            throw exhaustive(tokenPayload);
    }
}
