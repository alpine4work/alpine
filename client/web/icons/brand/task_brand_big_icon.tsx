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

const TaskBrandBigIconMemo = memo(TaskBrandBigIcon);
export {TaskBrandBigIconMemo as TaskBrandBigIcon};

function TaskBrandBigIcon({
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
        fill: mapObjectValues(brandIconSplashColorShade, shade => `green-${shade}` as const),
    });

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 48 48"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{width: spacing[size], height: spacing[size]}}
        >
            <path
                className={withoutStyleSheet === undefined ? splashColorClassName : undefined}
                fill={
                    withoutStyleSheet === "light"
                        ? colors[`green-${brandIconSplashColorShade.light}`]
                        : withoutStyleSheet === "dark"
                          ? invertedColorsWithShade[`green-${brandIconSplashColorShade.dark}`]
                          : undefined
                }
                opacity={brandIconSplashColorOpacity}
                d="M15 13.25h28v29a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4v-29Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M17.375 24c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H18a.625.625 0 0 1-.625-.625ZM17.375 30c0-.345.28-.625.625-.625h6a.625.625 0 1 1 0 1.25h-6a.625.625 0 0 1-.625-.625Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M8.375 7.5c0-.345.28-.625.625-.625h30c.345 0 .625.28.625.625v23a.625.625 0 1 1-1.25 0V8.125H9.625V37.5a3.875 3.875 0 0 0 3.875 3.875h14a.625.625 0 1 1 0 1.25h-14A5.125 5.125 0 0 1 8.375 37.5v-30Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M15 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM24 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM33 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM45.942 31.558a.625.625 0 0 1 0 .884l-10.5 10.5a.625.625 0 0 1-.884 0l-4.5-4.5a.625.625 0 1 1 .884-.884L35 41.616l10.058-10.058a.625.625 0 0 1 .884 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
