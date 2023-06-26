import {authorizeSpaceAccessWithOptimisticSessionAccountId} from "~/server/dynamo/spaces_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getRpcImplementationIfExists} from "~/server/rpc/get_rpc_implementation.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export async function action({request, context, span, params}: LoaderArgs) {
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
                const call = RpcHttpCallInputSchema.deserialize(await request.json());

                if (params.rpc_name !== call.name)
                    throw new InvalidArgumentError("Expected name in input to match name in URL");

                const rpcImplementation = await getRpcImplementationIfExists(call.name);

                if (!rpcImplementation)
                    throw new NotFoundError("Could not find an implementation for RPC");

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
            },
        );

        return response;
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
