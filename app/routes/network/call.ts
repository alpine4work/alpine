import {getNetworkFunctionImplementation} from "~/server/network/all_network_implementations";
import {commitSession, getSession} from "~/server/session/session";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";
import {
    NetworkFunctionHttpInputSchema,
    NetworkFunctionHttpOutputExecutionSchema,
    NetworkFunctionHttpOutputSchema,
} from "~/shared/network/helpers/network_function_http_schema";
import {SchemaType} from "~/shared/schema/schema";

export async function action({request}: {request: Request}) {
    try {
        const session = await getSession(request);

        if (request.method !== "POST")
            throw new InvalidArgumentError(
                "Must use POST HTTP method when executing network functions",
            );

        const input = NetworkFunctionHttpInputSchema.deserialize(await request.json());

        const results = await Promise.allSettled(
            input.executions.map(
                async (
                    execution,
                ): Promise<SchemaType<typeof NetworkFunctionHttpOutputExecutionSchema>> => {
                    try {
                        const networkFunctionImplementation = getNetworkFunctionImplementation(
                            execution.name,
                        );

                        if (!networkFunctionImplementation)
                            throw new NotFoundError(
                                "Could not find an implementation for network function",
                            );

                        const output = await networkFunctionImplementation.execute(
                            session,
                            execution.input,
                        );

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

        const executions = results.map(result => {
            if (result.status === "rejected") throw result.reason;
            return result.value;
        });

        const status =
            executions.length === 0
                ? 200
                : executions.reduce(
                      (status, execution) =>
                          Math.min(
                              status,
                              execution.ok ? 200 : isHttp500Error(execution.error) ? 500 : 400,
                          ),
                      500,
                  );

        return new Response(
            JSON.stringify(
                NetworkFunctionHttpOutputSchema.serialize({
                    ok: true,
                    executions,
                }),
            ),
            {
                status,
                headers: {
                    "Content-Type": "application/json",
                    // TODO(calebmer): This only changes the cookie when we initialize the
                    // `browserId`. Come up with a better design for cookies here.
                    "Set-Cookie": await commitSession(request, session),
                },
            },
        );
    } catch (error) {
        const status = isHttp500Error(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                NetworkFunctionHttpOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status,
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );
    }
}
