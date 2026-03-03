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

const ChatBrandIconMemo = memo(ChatBrandIcon);
export {ChatBrandIconMemo as ChatBrandIcon};

function ChatBrandIcon({
    size,
    withoutStyleSheet,
}: {
    size?: Spacing;
    withoutStyleSheet?: "light" | "dark";
}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        withoutStyleSheet !== undefined
            ? withoutStyleSheet === "light"
                ? colors[contentStyles.brandIconDefaultColor]
                : invertedColorsWithShade[contentStyles.brandIconDefaultColor]
            : contextColor === colorSchemeVars["grey-90"] ||
                contextColor === colorSchemeVars["grey-100"]
              ? contextColor
              : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const actualSize = size ? spacing[size] : (contextSize ?? spacing["5"]);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 20 20"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{width: actualSize, height: actualSize}}
        >
            <path
                className={
                    withoutStyleSheet === undefined
                        ? sprinkles({
                              fill: mapObjectValues(
                                  brandIconSplashColorShade,
                                  shade => `red-${shade}` as const,
                              ),
                          })
                        : undefined
                }
                fill={
                    withoutStyleSheet === "light"
                        ? colors[`red-${brandIconSplashColorShade.light}`]
                        : withoutStyleSheet === "dark"
                          ? invertedColorsWithShade[`red-${brandIconSplashColorShade.dark}`]
                          : undefined
                }
                opacity={brandIconSplashColorOpacity}
                fillRule="evenodd"
                d="M10.157 15.623a4.977 4.977 0 0 1-2.748-.72l-1.668.5a.417.417 0 0 1-.519-.52l.5-1.667a5 5 0 1 1 9.12-3.838l.158-.003a5 5 0 0 1 4.277 7.59l.5 1.669a.417.417 0 0 1-.518.519l-1.668-.5a5.002 5.002 0 0 1-7.434-3.03Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                d="M18.13 14.59a6.251 6.251 0 0 0-4.883-8.919 6.25 6.25 0 1 0-11.378 5.17L1.3 12.77a1.25 1.25 0 0 0 1.552 1.552l1.93-.568a6.28 6.28 0 0 0 1.968.575 6.25 6.25 0 0 0 8.464 3.176l1.93.567a1.25 1.25 0 0 0 1.553-1.551l-.568-1.931ZM4.843 12.46a.65.65 0 0 0-.176.026l-2.168.639.639-2.169a.625.625 0 0 0-.05-.468 5 5 0 1 1 2.052 2.051.625.625 0 0 0-.297-.078Zm12.015 2.245.641 2.17-2.168-.638a.625.625 0 0 0-.47.049 5.004 5.004 0 0 1-6.708-1.944 6.244 6.244 0 0 0 5.495-7.333 5 5 0 0 1 3.262 7.225.625.625 0 0 0-.05.472h-.002Z"
            />
        </svg>
    );
}
