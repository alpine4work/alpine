import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const PostBrandBigIconMemo = memo(PostBrandBigIcon);
export {PostBrandBigIconMemo as PostBrandBigIcon};

function PostBrandBigIcon({size = "12"}: {size?: Spacing}) {
    const {color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `orange-${shade}` as const),
        opacity: brandIconSplashColorOpacity,
    });

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 48 48"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{width: spacing[size], height: spacing[size]}}
        >
            <path
                className={splashColorClassName}
                d="M11.75 19.25a1 1 0 0 1 1-1h32.5a1 1 0 0 1 1 1v25a1 1 0 0 1-1 1h-32.5a1 1 0 0 1-1-1v-25Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M36 38.125c-2.61 0-4.782 1.727-5.396 4.036a.625.625 0 0 1-1.208-.322c.762-2.866 3.438-4.964 6.604-4.964s5.842 2.098 6.604 4.964a.625.625 0 1 1-1.208.322c-.614-2.31-2.787-4.036-5.396-4.036Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M36 29.125a3.875 3.875 0 1 0 0 7.75 3.875 3.875 0 0 0 0-7.75ZM30.875 33a5.125 5.125 0 1 1 10.25 0 5.125 5.125 0 0 1-10.25 0Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M7.5 11.125a.875.875 0 0 0-.875.875v25.5a.875.875 0 0 0 .875.875h15a.625.625 0 1 1 0 1.25h-15A2.125 2.125 0 0 1 5.375 37.5V12A2.125 2.125 0 0 1 7.5 9.875h33A2.125 2.125 0 0 1 42.625 12v10.5a.625.625 0 1 1-1.25 0V12a.875.875 0 0 0-.875-.875h-33Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M14.375 20.5c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H15a.625.625 0 0 1-.625-.625ZM14.375 26.5c0-.345.28-.625.625-.625h6a.625.625 0 1 1 0 1.25h-6a.625.625 0 0 1-.625-.625Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
