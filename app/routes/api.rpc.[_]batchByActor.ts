import {authenticateActorContextModule} from "~/app/helpers/authenticate_actor_context_module.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {allRpcImplementations} from "~/server/rpc/all_rpc_implementations.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    RpcHttpBatchByActorCallInputSchema,
    RpcHttpBatchCallErrorOutputSchema,
    RpcHttpBatchCallEventOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";

export async function action({request, context: loaderContext, span}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const body = await request.json();
        const batchCall = RpcHttpBatchByActorCallInputSchema.deserialize(
            body as SchemaSerializedValue,
        );

        if (batchCall.calls.length < 1) {
            throw new InvalidArgumentError("Expected at least one call in batch");
        }

        // Authenticate each actor and create a context object for that actor.
        const contextByActorIndex = await runAllPromises(
            batchCall.actors.map(async actor => {
                const actorContextModule = await authenticateActorContextModule(loaderContext, {
                    tokenAgent: loaderContext.loader.tokenAgent,
                    // We never allow session authentication for the `/api/rpc/_batchByActor` route.
                    sessionCookie: null,
                    authorizationHeader: actor.authorization,
                });

                return loaderContext.clone({actor: actorContextModule});
            }),
        );

        const outputPromises = batchCall.calls.map(call => {
            const rpcImplementation = allRpcImplementations.get(call.name);
            if (!rpcImplementation) {
                throw new NotFoundError(
                    quote`Could not find an implementation for RPC ${call.name}`,
                );
            }

            const context = contextByActorIndex[call.actorIndex];
            if (!context)
                throw new InvalidArgumentError(quote`Invalid actor index: ${call.actorIndex}`);

            const outputPromise = rpcImplementation.execute(
                context,
                call.id,
                call.input,
                call.tracerContext
                    ? {replaceTracerPropagationContext: call.tracerContext}
                    : undefined,
            );

            // Make sure to extend the context's lifetime until the RPC finishes executing.
            // Errors are passed to the client. We don't need to report them as uncaught
            // `waitUntil()` errors.
            context.process.waitUntil(outputPromise.catch(() => {}));

            return outputPromise;
        });

        // We stream call results to the client with in the ndjson format.
        // https://github.com/ndjson/ndjson-spec
        const stream = new ReadableStream({
            type: "bytes",
            start: async controller => {
                const encoder = new TextEncoder();

                await runAllPromises(
                    outputPromises.map(async (outputPromise, index) => {
                        let event: SchemaType<typeof RpcHttpBatchCallEventOutputSchema>;

                        try {
                            const output = await outputPromise;

                            event = {
                                index,
                                call: {ok: true, output},
                            };
                        } catch (error) {
                            event = {
                                index,
                                call: {ok: false, error},
                            };
                        }

                        controller.enqueue(
                            encoder.encode(
                                JSON.stringify(RpcHttpBatchCallEventOutputSchema.serialize(event)) +
                                    "\n",
                            ),
                        );
                    }),
                );

                controller.close();
            },
        });

        return new Response(stream, {
            status: 200,
            headers: {"content-type": "application/x-ndjson"},
        });
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                RpcHttpBatchCallErrorOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
