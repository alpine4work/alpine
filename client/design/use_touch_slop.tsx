import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {Spacing} from "~/shared/design/core/spacing.js";

// On desktop, we want button hit size to be 24x24 or larger.
export const desktopTouchSlopBySpacing: {
    [Key in "4" | "5" | "6" | "7" | "8" | "full"]: {
        readonly slop: Spacing;
        readonly sizeWithSlop: Spacing | "full";
    };
} = {
    "8": {slop: "0", sizeWithSlop: "8"},
    "7": {slop: "0", sizeWithSlop: "7"},
    "6": {slop: "0", sizeWithSlop: "6"},
    "5": {slop: "0.5", sizeWithSlop: "6"},
    "4": {slop: "1", sizeWithSlop: "6"},
    full: {slop: "0", sizeWithSlop: "full"},
};

// On mobile, we want button hit size to be 44x44 or larger.
export const mobileTouchSlopBySpacing: {
    [Key in "4" | "5" | "6" | "7" | "8" | "full"]: {
        readonly slop: Spacing;
        readonly sizeWithSlop: Spacing | "full";
    };
} = {
    "8": {slop: "0.5", sizeWithSlop: "9"},
    "7": {slop: "1", sizeWithSlop: "9"},
    "6": {slop: "1.5", sizeWithSlop: "9"},
    "5": {slop: "2", sizeWithSlop: "9"},
    "4": {slop: "2.5", sizeWithSlop: "9"},
    full: {slop: "0", sizeWithSlop: "full"},
};

type MaybeWithPlatform<T> = T | {mobile: T; desktop: T};

/**
 * Touch slop gives the user more space to hit a button. This is especially
 * important on mobile where [we want at least 44px by 44px][1] of hit region
 * per touchable target.
 *
 * Buttons of size `5` and below do not get any touch slop. These buttons we
 * consider too small for mobile. These button size should only be used when
 * the user has fine pointer control.
 *
 * We only add touch slop when rendering for mobile.
 *
 * [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
 */
export function useTouchSlop(spacing: MaybeWithPlatform<"4" | "5" | "6" | "7" | "8" | "full">): {
    slop: Spacing;
    sizeWithSlop: Spacing | "full";
} {
    const isMobile = useIsMobile();
    return isMobile
        ? mobileTouchSlopBySpacing[typeof spacing === "object" ? spacing.mobile : spacing]
        : desktopTouchSlopBySpacing[typeof spacing === "object" ? spacing.desktop : spacing];
}
