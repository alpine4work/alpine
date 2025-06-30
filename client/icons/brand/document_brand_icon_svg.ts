/* eslint-disable string-quotes */

import {brandIconDefaultColor} from "~/client/icons/brand/brand_icon_default_color.js";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const documentBrandIconSvg = ({
    size,
    color: colorFromProps,
}: {
    size?: Spacing | `${string}em`;
    color?: string;
}) => {
    const color = colorFromProps ?? colorSchemeVars[brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `blue-${shade}` as const),
        opacity: brandIconSplashColorOpacity,
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
        'viewBox="0 0 20 20" ' +
        `style="width: ${actualSize}; height: ${actualSize}">` +
        "<path " +
        `class="${splashColorClassName}" ` +
        'd="M6.146 5.312c0-.23.187-.416.417-.416h6.91c.111 0 .217.044.295.122l4.131 4.13a.416.416 0 0 1 .122.295v9.411c0 .23-.186.417-.416.417H6.563a.417.417 0 0 1-.417-.417V5.312Z" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'd="m16.692 6.433-4.375-4.375a.625.625 0 0 0-.442-.183h-7.5a1.25 1.25 0 0 0-1.25 1.25v13.75a1.25 1.25 0 0 0 1.25 1.25h11.25a1.25 1.25 0 0 0 1.25-1.25v-10a.624.624 0 0 0-.183-.442ZM12.5 4.009l2.241 2.241H12.5V4.009Zm3.125 12.866H4.375V3.125h6.875v3.75a.625.625 0 0 0 .625.625h3.75v9.375Zm-2.5-6.25a.624.624 0 0 1-.625.625h-5a.625.625 0 1 1 0-1.25h5a.624.624 0 0 1 .625.625Zm0 2.5a.624.624 0 0 1-.625.625h-5a.625.625 0 1 1 0-1.25h5a.624.624 0 0 1 .625.625Z" ' +
        "/>" +
        "</svg>"
    );
};
