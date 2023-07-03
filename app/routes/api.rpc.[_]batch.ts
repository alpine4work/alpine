import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getRpcImplementationIfExists} from "~/server/rpc/get_rpc_implementation.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    RpcHttpBatchCallInputSchema,
    RpcHttpBatchCallOutputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";

export async function action({request, context: loaderContext, span}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const [context, batchCall] = await runAllPromises([
            loaderContext.actor.authenticate(),
            request
                .json()
                .then(body =>
                    RpcHttpBatchCallInputSchema.deserialize(body as SchemaSerializedValue),
                ),
        ]);

        const results = await Promise.allSettled(
            batchCall.calls.map(
                async (call): Promise<SchemaType<typeof RpcHttpCallOutputSchema>> => {
                    try {
                        const rpcImplementation = getRpcImplementationIfExists(call.name);
                        if (!rpcImplementation)
                            throw new NotFoundError("Could not find an implementation for RPC");

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
                          Math.min(status, call.ok ? 200 : isSystemError(call.error) ? 500 : 400),
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
