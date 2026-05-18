import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

/**
 * Brand icon for Sites in raw SVG-string form. Mirrors `SiteBrandIcon` (the React
 * component) for use in HTML-rendered content like mention chips.
 */
export const siteBrandIconSvg = ({
    size,
    color: colorFromProps,
}: {
    size?: Spacing | `${string}em`;
    color?: string;
}) => {
    const color = colorFromProps ?? colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `cyan-${shade}` as const),
    });

    const actualSize = size
        ? size.endsWith("em")
            ? size
            : spacing[size as Spacing]
        : spacing["5"];

    return (
        "<svg " +
        'xmlns="http://www.w3.org/2000/svg" ' +
        'fill="none" ' +
        'viewBox="0 0 256 256" ' +
        `style="width: ${actualSize}; height: ${actualSize}">` +
        "<circle " +
        `class="${splashColorClassName}" ` +
        `opacity="${brandIconSplashColorOpacity}" ` +
        'cx="140" ' +
        'cy="140" ' +
        'r="88" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'd="M128 24a104 104 0 1 0 104 104A104.12 104.12 0 0 0 128 24Zm87.63 96h-40.19c-1.72-37.59-16.86-68.88-27.68-84.54A88.19 88.19 0 0 1 215.63 120ZM128 215.83c-8.84-9.38-27.56-35.67-32-87.83h64C155.56 180.16 136.84 206.45 128 215.83ZM96 120c4.44-52.16 23.16-78.45 32-87.83 8.84 9.38 27.56 35.67 32 87.83Zm12.24-84.54C97.42 51.12 82.28 82.41 80.56 120H40.37a88.19 88.19 0 0 1 67.87-84.54ZM40.37 136h40.19c1.72 37.59 16.86 68.88 27.68 84.54A88.19 88.19 0 0 1 40.37 136Zm107.39 84.54c10.82-15.66 25.96-46.95 27.68-84.54h40.19a88.19 88.19 0 0 1-67.87 84.54Z" ' +
        "/>" +
        "</svg>"
    );
};
