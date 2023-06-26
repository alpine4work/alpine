import {authorizeSpaceAccessWithOptimisticSessionAccountId} from "~/server/dynamo/spaces_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getRpcImplementationIfExists} from "~/server/rpc/get_rpc_implementation.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    RpcHttpBatchCallInputSchema,
    RpcHttpBatchCallOutputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export async function action({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const [, response] = await runAllPromiseThunks(
            // As a performance optimization we let RPC clients tell us the current space
            // ID so we can authorize space access in parallel with authorizing the
            // session.
            async () => {
                const currentSpaceId = Schema.id<SpaceId>()
                    .nullable()
                    .deserialize(request.headers.get("cyberworlds-current-space-id"));

                if (currentSpaceId) {
                    const sessionCookie = await context.loader.getSessionCookie();
                    await authorizeSpaceAccessWithOptimisticSessionAccountId(
                        context,
                        currentSpaceId,
                        sessionCookie.get().sessionAccountId ?? null,
                    );
                }
            },
            async () => {
                const batchCall = RpcHttpBatchCallInputSchema.deserialize(await request.json());

                const results = await Promise.allSettled(
                    batchCall.calls.map(
                        async (call): Promise<SchemaType<typeof RpcHttpCallOutputSchema>> => {
                            try {
                                const rpcImplementation = await getRpcImplementationIfExists(
                                    call.name,
                                );

                                if (!rpcImplementation)
                                    throw new NotFoundError(
                                        "Could not find an implementation for RPC",
                                    );

                                const output = await rpcImplementation.execute(context, call.input);

                                return {
                                    ok: true,
                                    output,
                                };
                            } catch (error) {
                                return {
                                    ok: false,
                                    error,
                                };
                            }
                        },
                    ),
                );

                const calls = results.map(result => {
                    if (result.status === "rejected") throw result.reason;
                    return result.value;
                });

                const status =
                    calls.length === 0
                        ? 200
                        : calls.reduce(
                              (status, call) =>
                                  Math.min(
                                      status,
                                      call.ok ? 200 : isSystemError(call.error) ? 500 : 400,
                                  ),
                              500,
                          );

                return new Response(
                    JSON.stringify(
                        RpcHttpBatchCallOutputSchema.serialize({
                            ok: true,
                            calls,
                        }),
                    ),
                    {
                        status,
                        headers: {"content-type": "application/json"},
                    },
                );
            },
        );

        return response;
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                RpcHttpBatchCallOutputSchema.serialize({
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
