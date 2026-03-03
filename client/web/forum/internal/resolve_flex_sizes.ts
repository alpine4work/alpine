/**
 * Performs a [simple flexbox layout algorithm][1] that currently only takes into
 * account max sizes and flex ratios. Can be used to layout on either a vertical or
 * horizontal axis. The name "size" is independent of what axis we're laying out.
 *
 * [1]: https://css-tricks.com/snippets/css/a-guide-to-flexbox
 */
export function resolveFlexSizes(
    totalSize: number,
    sizes: Iterable<{maxSize: number; flex: number}>,
): Array<number> {
    const currentSizes: Array<number | {maxSize: number; flex: number}> = Array.from(sizes);

    let resolvedSizes: Array<number> | null = null;

    while (resolvedSizes === null) {
        resolvedSizes = [];

        let availableFlex = 0;
        let availableSize = totalSize;

        for (const size of currentSizes) {
            if (typeof size === "number") {
                availableSize -= size;
            } else {
                availableFlex += size.flex;
            }
        }

        for (let i = 0; i < currentSizes.length; i++) {
            const size = currentSizes[i]!;

            if (typeof size === "number") {
                if (resolvedSizes !== null) {
                    resolvedSizes[i] = size;
                }
                continue;
            }

            const resolvedSize = availableSize * (size.flex / availableFlex);

            // If our resolved width exceeded the max width then try again
            if (resolvedSize > size.maxSize) {
                resolvedSizes = null;
                currentSizes[i] = size.maxSize;
            } else {
                if (resolvedSizes !== null) {
                    resolvedSizes[i] = resolvedSize;
                }
            }
        }
    }

    return resolvedSizes;
}
