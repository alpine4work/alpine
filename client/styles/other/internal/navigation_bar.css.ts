import {keyframes, style} from "@vanilla-extract/css";
import {easeOutQuart} from "~/shared/design/core/easing.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {Spacing, parseRemLength} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

// These constants are exported from `navigation_bar.tsx` for convenience.
// Generally you'll import from there unless you need this constant in CSS.
export const navigationBarHeight = {
    narrow: "14",
    wide: "16",
} as const satisfies Record<RouteLayout, Spacing>;

export const navigationBarHeightRem = mapObjectValues(navigationBarHeight, parseRemLength);

const navigationBarBackgroundFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const navigationBarBackgroundFadeOutAnimationClassName = style({
    animation: `${navigationBarBackgroundFadeOutKeyframes} 200ms ease-out forwards`,
});

const navigationBarTitleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.25rem)"},
});

export const navigationBarTitleFadeOutAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${navigationBarTitleFadeOutKeyframes} 250ms ${easeOutQuart.cubicBezier} forwards`,
});
