import {Session} from "~/server/session/session";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {NetworkFunction} from "~/shared/network/network-function";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type NetworkFunctionImplementation = {
    execute(session: Session, input: SchemaSerializedValue): Promise<SchemaSerializedValue>;
};

/**
 * Implements a network function on the server. Network functions are defined
 * in `~/shared/network` and implemented in `~/server/network`. This way the
 * client has access to the network definitions but only the server can
 * actually implement them.
 */
export function implementNetworkFunction<Input, Output>(
    networkFunction: NetworkFunction<Input, Output>,
    implementation: (input: Input, session: Session) => Promise<BlockInference<Output>>,
) {
    assert(
        !networkFunctionImplementationByName.has(networkFunction.name),
        quote`An implementation for network function ${networkFunction.name} already exists`,
    );

    const execute = async (
        session: Session,
        serializedInput: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue> => {
        const input = networkFunction.inputSchema.deserialize(serializedInput);
        const output = (await implementation(input, session)) as Output;
        return networkFunction.outputSchema.serialize(output);
    };

    networkFunctionImplementationByName.set(networkFunction.name, {
        execute,
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
