import type {NextApiRequest, NextApiResponse} from "next";
import {getNetworkFunctionImplementation} from "~/server/network/all-network-implementations";
import {ErrorBase, InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error-code";
import {isHttp500ErrorCode} from "~/shared/error/is-http-500-error-code";
import {
    NetworkFunctionHttpInputSchema,
    NetworkFunctionHttpOutputErrorSchema,
    NetworkFunctionHttpOutputExecutionSchema,
    NetworkFunctionHttpOutputSchema,
} from "~/shared/network/helpers/network-function-http-schema";
import {SchemaType} from "~/shared/schema/schema";

export default async function executeNetworkFunctions(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== "POST")
            throw new InvalidArgumentError(
                "Must use POST HTTP method when executing network functions",
            );

        const input = NetworkFunctionHttpInputSchema.deserialize(req.body);

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

                        const output = await networkFunctionImplementation.execute(execution.input);

                        return {
                            ok: true,
                            output,
                        };
                    } catch (error) {
                        return {
                            ok: false,
                            error: serializeError(error),
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
                              execution.ok
                                  ? 200
                                  : isHttp500ErrorCode(execution.error.code)
                                  ? 500
                                  : 400,
                          ),
                      500,
                  );

        res.status(status).json(
            NetworkFunctionHttpOutputSchema.serialize({
                ok: true,
                executions,
            }),
        );
    } catch (error) {
        const serializedError = serializeError(error);
        const status = isHttp500ErrorCode(serializedError.code) ? 500 : 400;

        res.status(status).json(
            NetworkFunctionHttpOutputSchema.serialize({
                ok: false,
                error: serializedError,
            }),
        );
    }
}

function serializeError(error: unknown): SchemaType<typeof NetworkFunctionHttpOutputErrorSchema> {
    return {
        code: error instanceof ErrorBase ? error.code : ErrorCode.Unknown,
        message: error instanceof Error ? error.message : "",
        // In development include more information about the error so we can
        // show a nice Next.js error dialog.
        //
        // In production, the stack trace leaks implementation details an attacker
        // could use so we don't want to include it.
        ...(process.env.NODE_ENV === "development" && error instanceof Error
            ? {name: error.name, stack: error.stack}
            : {}),
    };
}
