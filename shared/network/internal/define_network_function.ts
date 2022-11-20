import {InternalError, UnavailableError, UnimplementedError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";
import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {
    NetworkFunctionHttpInputSchema,
    NetworkFunctionHttpOutputSchema,
} from "~/shared/network/helpers/network_function_http_schema";
import {NetworkFunction} from "~/shared/network/network_function";
import {
    ObjectSchemaConfigBase,
    ObjectSchemaConfigType,
    Schema,
    SchemaDeserializationError,
    SchemaSerializedValue,
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

    const call = async (
        input: ObjectSchemaConfigType<InputConfig>,
    ): Promise<ObjectSchemaConfigType<OutputConfig>> => {
        if (typeof document === "undefined") {
            // NOTE(calebmer): Implement this with dependency injection so there's no
            // chance server code is bundled in with client code.
            throw new UnimplementedError("Server network function not yet implemented");
        }

        const outputPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

        scheduleNetworkFunctionCall({
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
    Object.defineProperty(call, "name", {value: name});

    return Object.assign(call, {
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

type NetworkFunctionCall = {
    readonly name: string;
    readonly input: SchemaSerializedValue;
    readonly outputPromiseResolver: PromiseResolver<SchemaSerializedValue>;
};

let scheduledNetworkFunctionCallBatch: Array<NetworkFunctionCall> | null = null;

function scheduleNetworkFunctionCall(call: NetworkFunctionCall): void {
    if (scheduledNetworkFunctionCallBatch === null) {
        scheduledNetworkFunctionCallBatch = [];
        scheduleMicrotask(() => {
            assert(scheduledNetworkFunctionCallBatch !== null);
            const callBatch = scheduledNetworkFunctionCallBatch;
            scheduledNetworkFunctionCallBatch = null;
            executeNetworkFunctions(callBatch).catch(scheduleUncaughtError);
        });
    }

    scheduledNetworkFunctionCallBatch.push(call);
}

async function executeNetworkFunctions(callBatch: Array<NetworkFunctionCall>): Promise<void> {
    // If this function throws any error, we want to reject all calls in our
    // batch with that error.
    try {
        const input = {
            calls: callBatch.map(call => ({
                name: call.name,
                input: call.input,
            })),
        };

        const response = await fetch("/network/call", {
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
            .then((output: any) => NetworkFunctionHttpOutputSchema.deserialize(output))
            .catch(error => {
                // If we fail to parse the response body as JSON, classify as `Internal`
                // status code.
                //
                // Maybe an error is also thrown here for some network errors? If so we should
                // classify network errors as the `Unavailable` status code.
                throw new InternalError(error.message, {cause: error});
            });

        if (!output.ok) {
            throw output.error;
        }

        if (output.calls.length !== callBatch.length)
            throw new InternalError(
                `Expected ${callBatch.length} call outputs but received ${output.calls.length} call outputs`,
            );

        callBatch.forEach((call, index) => {
            // If anything throws while processing the output for a single call,
            // reject only that call's promise.
            const callOutput = output.calls[index]!;
            if (!callOutput.ok) {
                call.outputPromiseResolver.reject(callOutput.error);
            } else {
                call.outputPromiseResolver.resolve(callOutput.output);
            }
        });
    } catch (error) {
        for (const call of callBatch) {
            call.outputPromiseResolver.reject(error);
        }
    }
}
