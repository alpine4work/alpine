import {Color} from "~/shared/design/colors";

/**
 * Theme color names like `red`, `blue`, and `green`.
 *
 * Excludes `grey` which is not a selectable theme.
 */
export type ThemeColor = Exclude<Color extends `${infer C}-${string}` ? C : never, "grey">;

// Use TypeScript object map syntax to force us to write every `ThemeColor` in
// code without caring about order.
const themeColorObject: {[K in ThemeColor]: true} = {
    red: true,
    orange: true,
    yellow: true,
    green: true,
    cyan: true,
    blue: true,
    indigo: true,
    purple: true,
    pink: true,
};

/**
 * All theme color names like `red`, `blue`, and `green`.
 *
 * Excludes `grey` which is not a selectable theme.
 */
export const themeColors = Object.keys(themeColorObject) as ReadonlyArray<ThemeColor>;
