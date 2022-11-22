/**
 * Inverse [linear interpolation][1]? idk, ask Alex.
 */
export function invLerp(a: number, b: number, n: number): number {
    return (n - a) / (b - a);
}
