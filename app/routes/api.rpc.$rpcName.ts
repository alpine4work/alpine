import {LoaderArgs} from "~/server/remix/loader_context.js";
import {allRpcImplementations} from "~/server/rpc/all_rpc_implementations.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export async function action({request, context: loaderContext, span, params}: LoaderArgs) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use POST HTTP method");

        const [context, call] = await runAllPromises([
            loaderContext.actor.authenticate(),
            request
                .json()
                .then(body => RpcHttpCallInputSchema.deserialize(body as SchemaSerializedValue)),
        ]);

        if (params.rpcName !== call.name)
            throw new InvalidArgumentError("Expected name in input to match name in URL");

        const rpcImplementation = allRpcImplementations.get(call.name);
        if (!rpcImplementation) throw new NotFoundError("Could not find an implementation for RPC");

        const output = await rpcImplementation.execute(context, call.id, call.input);

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
