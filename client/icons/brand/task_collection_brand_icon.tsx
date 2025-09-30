import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const TaskCollectionBrandIconMemo = memo(TaskCollectionBrandIcon);
export {TaskCollectionBrandIconMemo as TaskCollectionBrandIcon};

function TaskCollectionBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `green-${shade}` as const),
    });

    const actualSize = size ? spacing[size] : contextSize ?? spacing["5"];

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 20 20"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{width: actualSize, height: actualSize}}
        >
            <path
                className={splashColorClassName}
                opacity={brandIconSplashColorOpacity}
                d="M6.25 5.52h11.667v12.084c0 .92-.747 1.667-1.667 1.667H7.917c-.92 0-1.667-.746-1.667-1.667V5.521Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M3.125 3.125c0-.345.28-.625.625-.625h12.5c.345 0 .625.28.625.625V6.5a.625.625 0 1 1-1.25 0V3.75H4.375v11.875c0 .332.132.65.366.884a.625.625 0 0 1-.884.884 2.5 2.5 0 0 1-.732-1.768v-12.5Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M6.25 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM10 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM13.75 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM6.375 9c0-.345.28-.625.625-.625h12c.345 0 .625.28.625.625v8.5a1.125 1.125 0 0 1-1.125 1.125h-11A1.125 1.125 0 0 1 6.375 17.5V9Zm1.25.625v7.75h10.75v-7.75H7.625Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M6.375 12c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H7A.625.625 0 0 1 6.375 12Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M11 11.375c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
