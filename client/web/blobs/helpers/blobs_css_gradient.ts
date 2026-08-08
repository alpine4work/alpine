import {interpolateHcl} from "d3-interpolate";
import {Easing} from "~/shared/design/core/easing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {invLerp} from "~/shared/helpers/number/inv_lerp.js";

type ColorString = string;

export function generateEasedGradient(
    from: ColorString,
    to: ColorString,
    easingFunction: Easing,
    stops = 6,
): Array<ColorString> {
    const interpolate = interpolateHcl(from, to);
    return createArrayWithLength(stops, index => {
        const progress = invLerp(0, stops - 1, index);
        return interpolate(easingFunction(progress));
    });
}

export function formatCssLinearGradient(
    sideOrCorner: string,
    stops: ReadonlyArray<ColorString>,
): string {
    return `linear-gradient(${sideOrCorner}, ${stops.join(",")})`;
}
