export function binarySearchLessThanOrEqual(
    array: ReadonlyArray<number>,
    target: number,
): {index: number; value: number} | null {
    let left = 0;
    let right = array.length - 1;
    let result = -1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);

        if (array[mid]! <= target) {
            result = mid;
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    if (result === -1) return null;
    return {index: result, value: array[result]!};
}
