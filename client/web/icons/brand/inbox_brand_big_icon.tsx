import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {colors} from "~/shared/design/core/colors.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const InboxBrandBigIconMemo = memo(InboxBrandBigIcon);
export {InboxBrandBigIconMemo as InboxBrandBigIcon};

function InboxBrandBigIcon({
    size = "12",
    withoutStyleSheet,
}: {
    size?: Spacing;
    withoutStyleSheet?: "light" | "dark";
}) {
    const {color: contextColor} = useContext(IconContext);

    const color =
        withoutStyleSheet !== undefined
            ? withoutStyleSheet === "light"
                ? colors[contentStyles.brandIconDefaultColor]
                : invertedColorsWithShade[contentStyles.brandIconDefaultColor]
            : contextColor === colorSchemeVars["grey-90"] ||
                contextColor === colorSchemeVars["grey-100"]
              ? contextColor
              : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `purple-${shade}` as const),
    });

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 32 32"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{width: spacing[size], height: spacing[size]}}
        >
            <path
                className={withoutStyleSheet === undefined ? splashColorClassName : undefined}
                fill={
                    withoutStyleSheet === "light"
                        ? colors[`purple-${brandIconSplashColorShade.light}`]
                        : withoutStyleSheet === "dark"
                          ? invertedColorsWithShade[`purple-${brandIconSplashColorShade.dark}`]
                          : undefined
                }
                opacity={brandIconSplashColorOpacity}
                d="M15.438 26.375a3.813 3.813 0 0 0 7.624 0M10.672 15.89a8.578 8.578 0 1 1 17.156 0c0 4.268.989 7.697 1.775 9.055a.953.953 0 0 1-.822 1.43H9.72a.954.954 0 0 1-.82-1.43c.785-1.358 1.773-4.788 1.773-9.054Z"
            />
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={0.875}
                d="M12 24a4 4 0 1 0 8 0M7 13a9 9 0 0 1 18 0c0 4.477 1.038 8.075 1.863 9.5A1 1 0 0 1 26 24H6a1 1 0 0 1-.86-1.5C5.964 21.075 7 17.476 7 13Z"
            />
        </svg>
    );
}
