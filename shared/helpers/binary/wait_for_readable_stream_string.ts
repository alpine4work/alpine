/**
 * Wait for all the data from a `ReadableStream` and return the data concatenated
 * into one string. Assumes the `ReadableStream` is UTF-8 encoded if `encoding` is
 * not provided.
 */
export async function waitForReadableStreamString(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
    encoding?: string,
): Promise<string> {
    let string = "";

    const streamReader = stream.pipeThrough(new TextDecoderStream(encoding)).getReader();

    while (true) {
        const result = await streamReader.read();
        if (result.value !== undefined) string += result.value;
        if (result.done === true) break;
    }

    return string;
}
