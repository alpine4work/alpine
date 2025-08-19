import {Readable as NodeReadableStream} from "stream";

/**
 * Wait for all the data from a Node.js `ReadableStream` and return the data
 * concatenated into one `Uint8Array`.
 */
export async function waitForNodeReadableStreamUint8Array(
    stream: NodeReadableStream,
): Promise<Uint8Array> {
    const chunks: Array<Uint8Array> = [];

    for await (const chunk of stream) {
        if (Buffer.isBuffer(chunk)) {
            chunks.push(new Uint8Array(chunk));
        } else if (chunk instanceof Uint8Array) {
            chunks.push(chunk);
        } else {
            chunks.push(new Uint8Array(Buffer.from(chunk)));
        }
    }

    return concatUint8Arrays(chunks);
}

function concatUint8Arrays(chunks: Array<Uint8Array>): Uint8Array {
    const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}
