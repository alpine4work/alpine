/* eslint-disable string-quotes */

import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const taskBrandIconSvg = ({
    size,
    color: colorFromProps,
}: {
    size?: Spacing | `${string}em`;
    color?: string;
}) => {
    const color = colorFromProps ?? colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `green-${shade}` as const),
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
        'd="M6.25 5.52h11.667v12.084c0 .92-.747 1.667-1.667 1.667H7.917c-.92 0-1.667-.746-1.667-1.667V5.521Z" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M6.875 10c0-.345.28-.625.625-.625h5a.625.625 0 1 1 0 1.25h-5A.625.625 0 0 1 6.875 10ZM6.875 12.5c0-.345.28-.625.625-.625H10a.625.625 0 1 1 0 1.25H7.5a.625.625 0 0 1-.625-.625Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M3.125 3.125c0-.345.28-.625.625-.625h12.5c.345 0 .625.28.625.625V11a.625.625 0 1 1-1.25 0V3.75H4.375v11.875a1.25 1.25 0 0 0 1.25 1.25h4.833a.625.625 0 1 1 0 1.25H5.625a2.5 2.5 0 0 1-2.5-2.5v-12.5Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "<path " +
        `fill="${color}" ` +
        'fill-rule="evenodd" ' +
        'd="M6.25 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM10 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM13.75 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM19.395 12.891a.625.625 0 0 1 0 .884L15.02 18.15a.625.625 0 0 1-.884 0l-1.875-1.875a.625.625 0 1 1 .884-.884l1.433 1.433 3.933-3.933a.625.625 0 0 1 .884 0Z" ' +
        'clip-rule="evenodd" ' +
        "/>" +
        "</svg>"
    );
};
