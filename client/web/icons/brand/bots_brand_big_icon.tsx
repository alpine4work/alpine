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

const BotsBrandBigIconMemo = memo(BotsBrandBigIcon);
export {BotsBrandBigIconMemo as BotsBrandBigIcon};

function BotsBrandBigIcon({
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
        fill: mapObjectValues(brandIconSplashColorShade, shade => `pink-${shade}` as const),
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
                        ? colors[`pink-${brandIconSplashColorShade.light}`]
                        : withoutStyleSheet === "dark"
                          ? invertedColorsWithShade[`pink-${brandIconSplashColorShade.dark}`]
                          : undefined
                }
                opacity={brandIconSplashColorOpacity}
                d="M27.938 11.063H11.063a2.813 2.813 0 0 0-2.813 2.812V27a2.813 2.813 0 0 0 2.813 2.813h16.874A2.813 2.813 0 0 0 30.75 27V13.875a2.813 2.813 0 0 0-2.813-2.813Z"
            />
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={0.875}
                d="M25 7H7a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3V10a3 3 0 0 0-3-3ZM16 7V2"
            />
            <path
                fill={color}
                d="M10.5 14.375a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75ZM21.5 14.375a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75Z"
            />
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={0.875}
                d="M20.5 18h-9a2.5 2.5 0 0 0 0 5h9a2.5 2.5 0 0 0 0-5ZM18.5 18v5M13.5 18v5"
            />
        </svg>
    );
}
