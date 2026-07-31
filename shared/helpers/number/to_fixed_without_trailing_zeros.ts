/**
 * Same as `Number.toFixed()` but also trims trailing zeros from the end of the
 * string.
 */
export function toFixedWithoutTrailingZeros(value: number, fractionDigits: number): string {
    const string = value.toFixed(fractionDigits);

    let endIndex = string.length;

    for (let i = string.length - 1; i >= 0; i--) {
        if (string[i] !== "0") {
            endIndex = i + 1;
            break;
        }
    }

    if (string[endIndex - 1] === ".") endIndex--;

    if (endIndex === 0) return "0";

    return string.slice(0, endIndex);
}
