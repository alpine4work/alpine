import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {RpcHttpBatchCallEventOutputSchema} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export async function deserializeRpcBatchResponse(
    callBatch: ReadonlyArray<{outputPromiseResolver: PromiseResolver<SchemaSerializedValue>}>,
    response: Response,
) {
    const decoder = new TextDecoder();
    const reader = assertExists(response.body).getReader();

    async function* read(): AsyncIterableIterator<string> {
        let unfinishedString = "";

        while (true) {
            const result = await reader.read();

            if (result.value) {
                const chunkString = decoder.decode(result.value, {
                    stream: !result.done,
                });

                // If there's a newline in the output that means the content preceding the
                // newline has at least one valid event maybe more.
                let newLineIndex = chunkString.lastIndexOf("\n");

                if (newLineIndex !== -1) {
                    newLineIndex += unfinishedString.length;
                }

                unfinishedString =
                    unfinishedString.length === 0 ? chunkString : unfinishedString + chunkString;

                if (newLineIndex !== -1) {
                    const finishedString = unfinishedString.slice(0, newLineIndex);
                    unfinishedString = unfinishedString.slice(newLineIndex + 1);

                    yield* finishedString.split("\n");
                }
            }

            if (result.done) {
                break;
            }
        }

        // Once we're done reading, we assume the last string is also valid JSON.
        // Unless the string is empty. Then we assume it's a trailing newline.
        if (unfinishedString.length !== 0) {
            yield unfinishedString;
        }
    }

    for await (const eventString of read()) {
        const event = RpcHttpBatchCallEventOutputSchema.deserialize(JSON.parse(eventString));

        const call = callBatch[event.index];
        const callOutput = event.call;

        if (!call) {
            throw new InternalError("Batch request included output for an unknown call");
        }

        // If anything throws while processing the output for a single call,
        // reject only that call's promise.
        if (!callOutput.ok) {
            call.outputPromiseResolver.reject(callOutput.error);
        } else {
            call.outputPromiseResolver.resolve(callOutput.output);
        }
    }

    for (const call of callBatch) {
        if (!call.outputPromiseResolver.isSettled()) {
            call.outputPromiseResolver.reject(
                new InternalError("Batch request didn\u2019t include output for call"),
            );
        }
    }
}
