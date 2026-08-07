import {generateId} from "~/shared/id/id.open_source.js";
import {RpcHttpCallInputSchema} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

/**
 * Uses [`navigator.sendBeacon()`][1] to execute an RPC. `navigator.sendBeacon()`
 * can be called before the page unloads to send a request to the server. Typically
 * it's used for sending analytics to the server but can also be used for saving
 * data when the browser closes. This method won't batch RPC calls or retry on
 * transient error. You aren't allowed to get the output of this request.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
 */
export function sendRpcNavigatorBeacon<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    input: Input,
) {
    navigator.sendBeacon(
        `/api/rpc/${definition.name}`,
        JSON.stringify(
            RpcHttpCallInputSchema.serialize({
                id: generateId(),
                name: definition.name,
                input: definition.inputSchema.serialize(input),
            }),
        ),
    );
}
