/**
 * Run iterable to completion, discarding all values.
 */
export function exhaustIterable<Item>(iterable: Iterable<Item>): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const item of iterable) {
        // noop
    }
}
