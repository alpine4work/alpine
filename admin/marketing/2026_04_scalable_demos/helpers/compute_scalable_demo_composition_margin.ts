import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function computeScalableDemoCompositionMargin(width: number, height: number): number {
    const w = width;
    const h = height;
    const r = goldenRatio;

    // Solution for `m` in:
    //
    // ```
    // w * h * r = (w + m * 2) * (h + m * 2)
    // ```
    //
    // ([WolframAlpha][1])
    //
    // We want the area of the composition to be in the golden ratio with the area of
    // the recording. And we want consistent vertical/horizontal margins.
    //
    // [1]:
    //     https://www.wolframalpha.com/input?i=solve+for+m+in+w+*+h+*+r+%3D+%28w+%2B+m+*+2%29+*+%28h+%2B+m+*+2%29
    const m = (1 / 4) * (Math.sqrt(h ** 2 + 4 * h * r * w - 2 * h * w + w ** 2) - h - w);

    return m;
}
