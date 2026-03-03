/**
 * Wait for all the data from a `ReadableStream` and return the data concatenated
 * into one `Uint8Array`.
 */
export async function waitForReadableStreamUint8Array(
    stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
    const chunks: Array<Uint8Array> = [];

    const streamReader = stream.getReader();

    while (true) {
        const result = await streamReader.read();
        if (result.value !== undefined) chunks.push(result.value);
        if (result.done === true) break;
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
