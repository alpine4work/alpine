/**
 * Get the average of all the numbers in the iterable.
 */
export function averageIterable(iterable: Iterable<number>): number {
    let sum = 0;
    let count = 0;

    for (const item of iterable) {
        sum += item;
        count++;
    }

    return sum / count;
}
