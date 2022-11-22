/**
 * A function that performs [linear interpolation][1].
 *
 * [1]: https://en.wikipedia.org/wiki/Linear_interpolation
 */
export function lerp(a: number, b: number, n: number): number {
    return (b - a) * n + a;
}
