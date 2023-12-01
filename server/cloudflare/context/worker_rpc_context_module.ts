import {WorkerActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {TokenAgentBase, TokenPayload} from "~/server/tokens/token_agent.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

/**
 * Executes an RPC from our edge service.
 */
export class WorkerRpcContextModule extends RpcContextModuleBase<{
    tracer: TracerContextModule;
    actor: WorkerActorContextModule;
}> {
    private readonly _protocol: string;
    private readonly _host: string;
    private readonly _tokenAgent: TokenAgentBase;
    private readonly _cookieJar: CookieJar;

    constructor({
        protocol,
        host,
        tokenAgent,
        cookieJar,
    }: {
        protocol: string;
        host: string;
        tokenAgent: TokenAgentBase;
        cookieJar: CookieJar;
    }) {
        super();
        this._protocol = protocol;
        this._host = host;
        this._tokenAgent = tokenAgent;
        this._cookieJar = cookieJar;
    }

    public execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output> {
        return this._context.tracer.withSpan(
            `RPC client ${definition.name}`,
            async (context, span) => {
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
                    default:
                        throw exhaustive(context.actor);
                }

                const token = await this._tokenAgent.dangerouslySignShortLivedToken(
                    "AppService",
                    tokenPayload,
                );

                const spaceIdFromSpan = span.getContextSpaceIdIfExists();

                return fetchWithTracer(
                    span,
                    new URL(`${this._protocol}//${this._host}/api/rpc/${definition.name}`),
                    {
                        serviceName: "AppService",
                        route: "/api/rpc/:rpcName",
                        // When communicating via RPC, share cookies across requests. Particularly we
                        // care about the [AWS ALB sticky session cookies][1] which make sure requests
                        // from our Durable Object go to the same underlying host in AWS. That way
                        // caches in `AppService` work properly.
                        //
                        // [1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
                        cookieJar: this._cookieJar,
                        method: "POST",
                        headers: {
                            authorization: `bearer ${token}`,
                            "content-type": "application/json",
                            // As an optimization, include the space ID from our `TracerSpan` in RPC calls
                            // which we'll use to authorize whether the current account has access to the
                            // requested space.
                            //
                            // This does not provide any security guarantees! This is purely a performance
                            // optimization to authorize the session and space access at once.
                            ...(spaceIdFromSpan
                                ? {"cyberworlds-space-id-hint": spaceIdFromSpan}
                                : {}),
                        },
                        body: JSON.stringify(
                            RpcHttpCallInputSchema.serialize({
                                name: definition.name,
                                input: definition.inputSchema.serialize(input),
                            }),
                        ),
                    },
                    async response => {
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

                        if (!callOutput.ok) throw callOutput.error;
                        return definition.outputSchema.deserialize(callOutput.output);
                    },
                );
            },
        );
    }

    public fork(): WorkerRpcContextModule {
        return new WorkerRpcContextModule({
            protocol: this._protocol,
            host: this._host,
            tokenAgent: this._tokenAgent,
            cookieJar: this._cookieJar,
        });
    }
}
