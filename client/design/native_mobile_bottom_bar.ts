import {parseRemLengthNumber, remPxByPlatform, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * The height of a keyboard toolbar. A keyboard toolbar is a special kind of
 * native mobile bottom bar. It only appears when the keyboard is open. Unlike
 * regular bottom bars which are always visible and move up with the keyboard.
 *
 * Keyboard toolbars have a fixed height since we need to animate them in from
 * completely offscreen to the proper position above the keyboard.
 */
export const nativeMobileBottomBarKeyboardToolbarHeight = "10";

export const nativeMobileBottomBarKeyboardToolbarHeightRem = parseRemLengthNumber(
    spacing[nativeMobileBottomBarKeyboardToolbarHeight],
);

{
    // IMPORTANT: If you change this value, you must also change
    // `bottomBarKeyboardToolbarHeight` in `BottomBarConstants.swift`.
    //
    // We have an assertion below to make sure this value always equals the
    // bottom bar's pixel height on mobile devices. After converting `Spacing`
    // to an actual value and applying the rem pixel count.
    const nativeMobileBottomBarKeyboardToolbarHeight = 50;

    assert(
        nativeMobileBottomBarKeyboardToolbarHeightRem * remPxByPlatform.mobile ===
            nativeMobileBottomBarKeyboardToolbarHeight,
    );
}
