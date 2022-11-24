import {getNetworkFunctionImplementation} from "~/server/network/all_network_implementations";
import {Session} from "~/server/session/session";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isHttp500Error} from "~/shared/error/is_http_500_error_code";
import {
    NetworkFunctionHttpInputSchema,
    NetworkFunctionHttpOutputCallSchema,
    NetworkFunctionHttpOutputSchema,
} from "~/shared/network/helpers/network_function_http_schema";
import {SchemaType} from "~/shared/schema/schema";

export async function action({request}: {request: Request}) {
    let _session: Session | null = null;
    try {
        const session = (_session = await Session.new(request));

        if (request.method !== "POST")
            throw new InvalidArgumentError(
                "Must use POST HTTP method when executing network functions",
            );

        const input = NetworkFunctionHttpInputSchema.deserialize(await request.json());

        const results = await Promise.allSettled(
            input.calls.map(
                async (call): Promise<SchemaType<typeof NetworkFunctionHttpOutputCallSchema>> => {
                    try {
                        const networkFunctionImplementation = getNetworkFunctionImplementation(
                            call.name,
                        );

                        if (!networkFunctionImplementation)
                            throw new NotFoundError(
                                "Could not find an implementation for network function",
                            );

                        const output = await networkFunctionImplementation.execute(
                            session.get(),
                            call.input,
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

        const calls = results.map(result => {
            if (result.status === "rejected") throw result.reason;
            return result.value;
        });

        const status =
            calls.length === 0
                ? 200
                : calls.reduce(
                      (status, call) =>
                          Math.min(status, call.ok ? 200 : isHttp500Error(call.error) ? 500 : 400),
                      500,
                  );

        const response = new Response(
            JSON.stringify(
                NetworkFunctionHttpOutputSchema.serialize({
                    ok: true,
                    calls,
                }),
            ),
            {
                status,
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );

        await session.commit(response);

        return response;
    } catch (error) {
        const status = isHttp500Error(error) ? 500 : 400;

        const response = new Response(
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

        // Commit the session if we have one and there are changes. We won't have a
        // session if an error was thrown while we were creating the session.
        await _session?.commit(response);

        return response;
    }
}
