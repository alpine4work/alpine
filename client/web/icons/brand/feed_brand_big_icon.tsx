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

const FeedBrandBigIconMemo = memo(FeedBrandBigIcon);
export {FeedBrandBigIconMemo as FeedBrandBigIcon};

function FeedBrandBigIcon({
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
        fill: mapObjectValues(brandIconSplashColorShade, shade => `cyan-${shade}` as const),
    });

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 32 32"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{width: spacing[size], height: spacing[size]}}
        >
            <path
                className={withoutStyleSheet === undefined ? splashColorClassName : undefined}
                fill={
                    withoutStyleSheet === "light"
                        ? colors[`cyan-${brandIconSplashColorShade.light}`]
                        : withoutStyleSheet === "dark"
                          ? invertedColorsWithShade[`cyan-${brandIconSplashColorShade.dark}`]
                          : undefined
                }
                opacity={brandIconSplashColorOpacity}
                d="M10.096 11.065a.969.969 0 0 0-.283.685v16.469h19.374a1.938 1.938 0 0 0 1.938-1.938V11.75a.97.97 0 0 0-.969-.969H10.781a.969.969 0 0 0-.685.284Z"
            />
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={0.875}
                d="M12 14h10M12 18h10M4 25a2 2 0 0 0 2-2V8a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v15a2 2 0 0 1-2 2H4ZM4 25a2 2 0 0 1-2-2V11"
            />
        </svg>
    );
}
