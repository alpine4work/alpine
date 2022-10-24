import {
    ErrorBase,
    InternalError,
    NotFoundError,
    UnavailableError,
    getErrorConstructorForCode,
} from "~/shared/error/error";
import {isErrorCode} from "~/shared/error/error-code";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {scheduleException} from "~/shared/helpers/async/schedule-exception";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {isPlainObject} from "~/shared/helpers/object/is-plain-object";
import {isIdentifier} from "~/shared/helpers/string/is-identifier";
import {quote} from "~/shared/helpers/string/quote";
import {
    NetworkFunctionHttpInputSchema,
    NetworkFunctionHttpOutputErrorSchema,
    NetworkFunctionHttpOutputSchema,
} from "~/shared/network/helpers/network-function-http-schema";
import {NetworkFunction} from "~/shared/network/network-function";
import {
    ObjectSchemaConfigBase,
    ObjectSchemaConfigType,
    Schema,
    SchemaDeserializationError,
    SchemaSerializedValue,
    SchemaType,
} from "~/shared/schema/schema";

/**
 * Define the interface for a network function.
 *
 * Network functions must all be defined in `~/shared/network`. That way our
 * tooling can pick up all defined network functions and ensure there is a
 * matching implementation on the server.
 *
 * We define network functions in separate files so that code splitting works.
 * Importing one network function only imports the dependencies for that
 * network function and nothing else.
 *
 * A network function has an input object and an output object. If you already
 * have an object schema, we discourage you from reusing it. Instead nest your
 * object schema in a named property. This will allow you to add more inputs
 * and outputs over time to the network function.
 */
export function defineNetworkFunction<
    InputConfig extends ObjectSchemaConfigBase,
    OutputConfig extends ObjectSchemaConfigBase,
>({
    name,
    input: inputConfig,
    output: outputConfig,
}: {
    name: string;
    input: InputConfig;
    output: OutputConfig;
}): NetworkFunction<ObjectSchemaConfigType<InputConfig>, ObjectSchemaConfigType<OutputConfig>> {
    assert(isIdentifier(name), "Network function name should be a valid identifier");
    assert(
        name[0] === name[0]?.toLowerCase(),
        "Network function name should start with a lower case letter",
    );

    assert(
        !definedNetworkFunctionNames.has(name),
        quote`A definition for a network function named ${name} already exists`,
    );
    definedNetworkFunctionNames.add(name);

    const inputSchema = Schema.object(inputConfig);
    const outputSchema = Schema.object(outputConfig);

    const execute = async (
        input: ObjectSchemaConfigType<InputConfig>,
    ): Promise<ObjectSchemaConfigType<OutputConfig>> => {
        if (typeof window === "undefined") {
            const {getNetworkFunctionImplementation} = await import(
                // Only executes on the server so it's fine to import a server file.
                // eslint-disable-next-line import/no-restricted-paths
                "~/server/network/all-network-implementations"
            );

            const networkFunctionImplementation = getNetworkFunctionImplementation(name);

            if (!networkFunctionImplementation)
                throw new NotFoundError(
                    "Referenced a network function name that does not have an implementation",
                );

            // Since we are executing the network function in the same process it was
            // defined, we skip schema serialization and deserialization for performance.
            //
            // TODO(calebmer): Arguably we shouldn't skip serialization and deserialization
            // since it may perform important validation. Perhaps schemas should have a
            // `validate()` function to run those validations without expensive
            // serialization/deserialization?
            return networkFunctionImplementation.dangerouslyExecuteWithoutSchema(input);
        }

        const outputPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

        scheduleNetworkFunctionExecution({
            name,
            input: inputSchema.serialize(input),
            outputPromiseResolver,
        });

        const output = await outputPromiseResolver.promise;

        try {
            return outputSchema.deserialize(output);
        } catch (error) {
            // Reclassify deserialization errors as internal errors if we can't deserialize
            // the data coming from our network function HTTP endpoint.
            if (error instanceof SchemaDeserializationError) {
                throw new InternalError(error.message, {cause: error});
            }
            throw error;
        }
    };

    // Override the JavaScript function name with our network function name. We
    // need to use `Object.defineProperty()` to override the JavaScript
    // builtin name.
    Object.defineProperty(execute, "name", {value: name});

    return Object.assign(execute, {
        inputSchema,
        outputSchema,
    });
}

const definedNetworkFunctionNames = new Set<string>();

/**
 * Get the names of all network functions that have been defined.
 */
export function getAllDefinedNetworkFunctionNames(): IterableIterator<string> {
    return definedNetworkFunctionNames.values();
}

type NetworkFunctionExecution = {
    readonly name: string;
    readonly input: SchemaSerializedValue;
    readonly outputPromiseResolver: PromiseResolver<SchemaSerializedValue>;
};

let scheduledNetworkFunctionExecutionBatch: Array<NetworkFunctionExecution> | null = null;

function scheduleNetworkFunctionExecution(execution: NetworkFunctionExecution): void {
    if (scheduledNetworkFunctionExecutionBatch === null) {
        scheduledNetworkFunctionExecutionBatch = [];
        scheduleMicrotask(() => {
            assert(scheduledNetworkFunctionExecutionBatch !== null);
            const executionBatch = scheduledNetworkFunctionExecutionBatch;
            scheduledNetworkFunctionExecutionBatch = null;
            executeNetworkFunctions(executionBatch).catch(scheduleException);
        });
    }

    scheduledNetworkFunctionExecutionBatch.push(execution);
}

async function executeNetworkFunctions(
    executionBatch: Array<NetworkFunctionExecution>,
): Promise<void> {
    // If this function throws any error, we want to reject all executions in our
    // batch with that error.
    try {
        const input = {
            executions: executionBatch.map(execution => ({
                name: execution.name,
                input: execution.input,
            })),
        };

        const response = await fetch("/api/network-function-call", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(NetworkFunctionHttpInputSchema.serialize(input)),
        }).catch(error => {
            // Classify network errors as the `Unavailable` status code.
            throw new UnavailableError(error.message, {cause: error});
        });

        const output = await response
            .json()
            .then(output => NetworkFunctionHttpOutputSchema.deserialize(output))
            .catch(error => {
                // If we fail to parse the response body as JSON, classify as `Internal`
                // status code.
                //
                // Maybe an error is also thrown here for some network errors? If so we should
                // classify network errors as the `Unavailable` status code.
                throw new InternalError(error.message, {cause: error});
            });

        if (!output.ok) {
            const error = await deserializeError(output.error);
            throw error;
        }

        if (output.executions.length !== executionBatch.length)
            throw new InternalError(
                `Expected ${executionBatch.length} execution outputs but received ${output.executions.length} execution outputs`,
            );

        executionBatch.forEach((execution, index) => {
            // If anything throws while processing the output for a single execution,
            // reject only that execution's promise.
            const executionOutput = output.executions[index]!;
            if (!executionOutput.ok) {
                deserializeError(executionOutput.error).then(
                    error => execution.outputPromiseResolver.reject(error),
                    error => execution.outputPromiseResolver.reject(error),
                );
            } else {
                execution.outputPromiseResolver.resolve(executionOutput.output);
            }
        });
    } catch (error) {
        for (const execution of executionBatch) {
            execution.outputPromiseResolver.reject(error);
        }
    }
}

async function deserializeError(
    error: SchemaType<typeof NetworkFunctionHttpOutputErrorSchema>,
): Promise<ErrorBase> {
    if (!isPlainObject(error)) throw new InternalError("Expected error object");

    if (typeof error.message !== "string")
        throw new InternalError("Missing message string on error object");

    if (typeof error.code !== "number" || !isErrorCode(error.code))
        throw new InternalError("Invalid code on error object");

    // In development, we want to show the Next.js error overlay on a server
    // error. So use the internal dev overlay function to format server errors.
    if (process.env.NODE_ENV === "development") {
        const {getServerError} = await import(
            // @ts-expect-error: Importing an internal file from Next.js like we do here:
            // https://github.com/vercel/next.js/blob/6249307b75ebd21bbf86895cde177d8c6f82fe94/packages/next/client/index.tsx#L830-L832
            "next/dist/compiled/@next/react-dev-overlay/dist/client"
        );
        const devError = getServerError(error as any, "server");

        // Massage the error Next.js creates into an `ErrorBase` with the
        // appropriate status code.
        devError.code = error.code;
        Object.setPrototypeOf(devError, getErrorConstructorForCode(error.code).prototype);

        throw devError;
    } else {
        const ErrorConstructor = getErrorConstructorForCode(error.code);
        throw new ErrorConstructor(error.message);
    }
}
