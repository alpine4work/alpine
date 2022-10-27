import {getSessionFromAsyncLocalStorage} from "~/server/session/session-async-local-storage";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {NetworkFunction} from "~/shared/network/network-function";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type NetworkFunctionImplementation = {
    execute(input: SchemaSerializedValue): Promise<SchemaSerializedValue>;
    dangerouslyExecuteWithoutSchema(input: any): Promise<any>;
};

/**
 * Implements a network function on the server. Network functions are defined
 * in `~/shared/network` and implemented in `~/server/network`. This way the
 * client has access to the network definitions but only the server can
 * actually implement them.
 */
export function implementNetworkFunction<Input, Output>(
    networkFunction: NetworkFunction<Input, Output>,
    implementation: (input: Input) => Promise<BlockInference<Output>>,
) {
    assert(
        !networkFunctionImplementationByName.has(networkFunction.name),
        quote`An implementation for network function ${networkFunction.name} already exists`,
    );

    const execute = async (
        serializedInput: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue> => {
        console.log("DEBUG 5", getSessionFromAsyncLocalStorage());

        const input = networkFunction.inputSchema.deserialize(serializedInput);
        const output = (await implementation(input)) as Output;
        return networkFunction.outputSchema.serialize(output);
    };

    networkFunctionImplementationByName.set(networkFunction.name, {
        execute,
        dangerouslyExecuteWithoutSchema: implementation,
    });
}

const networkFunctionImplementationByName = new Map<string, NetworkFunctionImplementation>();

/**
 * Get the names of all network functions that have been implemented.
 */
export function getAllImplementedNetworkFunctionNames(): IterableIterator<string> {
    return networkFunctionImplementationByName.keys();
}

/**
 * Get the implementation for a network function with the given name if it has
 * been implemented by now. Usually you will want import
 * `~/server/network/all-network-implementations` to make sure all network
 * function implementations have been initialized.
 */
export function getNetworkFunctionImplementationIfExists(
    name: string,
): NetworkFunctionImplementation | null {
    return networkFunctionImplementationByName.get(name) ?? null;
}
