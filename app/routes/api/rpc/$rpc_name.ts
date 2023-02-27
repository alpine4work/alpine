import {LoaderArgs} from "~/server/remix/loader_context";
import {getRpcImplementation} from "~/server/rpc/get_rpc_implementation";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema";

export async function action({request, context, span, params}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const call = RpcHttpCallInputSchema.deserialize(await request.json());

        if (params.rpc_name !== call.name)
            throw new InvalidArgumentError("Expected name in input to match name in URL");

        const rpcImplementation = getRpcImplementation(call.name);

        if (!rpcImplementation) throw new NotFoundError("Could not find an implementation for RPC");

        const output = await rpcImplementation.execute(context, call.input);

        return new Response(
            JSON.stringify(
                RpcHttpCallOutputSchema.serialize({
                    ok: true,
                    output,
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);

        const status = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                RpcHttpCallOutputSchema.serialize({
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
