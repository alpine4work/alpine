/* eslint-disable string-quotes */

import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const postBrandIconSvg = ({
    size,
    color: colorFromProps,
}: {
    size?: Spacing | `${string}em`;
    color?: string;
}) => {
    const color = colorFromProps ?? colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `orange-${shade}` as const),
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
        `opacity="${brandIconSplashColorOpacity}" ` +
        'd="M4.896 8.02c0-.23.187-.416.417-.416h13.542c.23 0 .416.187.416.417v10.417c0 .23-.186.416-.416.416H5.313a.417.417 0 0 1-.417-.416V8.02Z" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M15 16.25c-.925 0-1.683.611-1.896 1.41a.625.625 0 0 1-1.208-.32C12.257 15.982 13.52 15 15 15c1.482 0 2.743.983 3.104 2.34a.625.625 0 1 1-1.208.32c-.213-.799-.971-1.41-1.896-1.41Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M15 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm-2.5 1.25a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M2.241 4.116a1.25 1.25 0 0 1 .884-.366h13.75A1.25 1.25 0 0 1 18.125 5v4.375a.625.625 0 1 1-1.25 0V5H3.125v10.625h6.25a.625.625 0 1 1 0 1.25h-6.25a1.25 1.25 0 0 1-1.25-1.25V5c0-.332.132-.65.366-.884Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M5.625 8.542c0-.345.28-.625.625-.625h5a.625.625 0 1 1 0 1.25h-5a.625.625 0 0 1-.625-.625ZM5.625 11.042c0-.345.28-.625.625-.625h2.5a.625.625 0 0 1 0 1.25h-2.5a.625.625 0 0 1-.625-.625Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "</svg>"
    );
};
