import {LoaderArgs} from "~/server/remix/loader_context";
import {getRpcImplementation} from "~/server/rpc/get_rpc_implementation";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {
    RpcHttpInputSchema,
    RpcHttpOutputCallSchema,
    RpcHttpOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema";
import {SchemaType} from "~/shared/schema/schema";

export async function action({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const input = RpcHttpInputSchema.deserialize(await request.json());

        const results = await Promise.allSettled(
            input.calls.map(async (call): Promise<SchemaType<typeof RpcHttpOutputCallSchema>> => {
                try {
                    const rpcImplementation = getRpcImplementation(call.name);

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
            }),
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
                RpcHttpOutputSchema.serialize({
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
                RpcHttpOutputSchema.serialize({
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
