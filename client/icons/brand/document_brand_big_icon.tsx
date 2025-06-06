import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const DocumentBrandBigIconMemo = memo(DocumentBrandBigIcon);
export {DocumentBrandBigIconMemo as DocumentBrandBigIcon};

function DocumentBrandBigIcon({size = "12"}: {size?: Spacing}) {
    const {color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars["grey-80"];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `blue-${shade}` as const),
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
                d="M14.75 12.75a1 1 0 0 1 1-1h16.586a1 1 0 0 1 .707.293l9.914 9.914a1 1 0 0 1 .293.707V45.25a1 1 0 0 1-1 1h-26.5a1 1 0 0 1-1-1v-32.5Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M10.5 6.625a.875.875 0 0 0-.875.875v33a.875.875 0 0 0 .875.875h27a.875.875 0 0 0 .875-.875V16.759L28.241 6.625H10.5Zm-1.503-.628a2.125 2.125 0 0 1 1.503-.622h18c.166 0 .325.066.442.183l10.5 10.5a.624.624 0 0 1 .183.442v24a2.125 2.125 0 0 1-2.125 2.125h-27A2.125 2.125 0 0 1 8.375 40.5v-33c0-.564.224-1.104.622-1.503Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M28.5 5.375c.345 0 .625.28.625.625v9.875H39a.625.625 0 1 1 0 1.25H28.5a.625.625 0 0 1-.625-.625V6c0-.345.28-.625.625-.625ZM17.375 25.5c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H18a.625.625 0 0 1-.625-.625ZM17.375 31.5c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H18a.625.625 0 0 1-.625-.625Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
