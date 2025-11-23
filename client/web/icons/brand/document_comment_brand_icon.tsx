import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const DocumentCommentBrandIconMemo = memo(DocumentCommentBrandIcon);
export {DocumentCommentBrandIconMemo as DocumentCommentBrandIcon};

function DocumentCommentBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `blue-${shade}` as const),
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
                d="M3.7 3.117c0-.23.186-.417.416-.417h6.91c.111 0 .217.044.295.122l4.131 4.13a.417.417 0 0 1 .122.296v9.41c0 .23-.186.417-.416.417H4.116a.417.417 0 0 1-.417-.417V3.117Z"
            />

            <path
                fill={color}
                fillRule="evenodd"
                d="M1.741.741a1.25 1.25 0 0 1 .884-.366h7.5c.166 0 .325.066.442.183l4.375 4.375a.625.625 0 1 1-.884.884L9.866 1.625H2.625v13.75h2.171a.625.625 0 1 1 0 1.25H2.625a1.25 1.25 0 0 1-1.25-1.25V1.625c0-.332.132-.65.366-.884Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M10 .375c.345 0 .625.28.625.625v3.75h3.75a.625.625 0 1 1 0 1.25H10a.625.625 0 0 1-.625-.625V1c0-.345.28-.625.625-.625ZM4.625 9.125c0-.345.28-.625.625-.625h1a.625.625 0 1 1 0 1.25h-1a.625.625 0 0 1-.625-.625ZM4.375 12c0-.345.28-.625.625-.625h.5a.625.625 0 1 1 0 1.25H5A.625.625 0 0 1 4.375 12ZM9.02 8.143a6.125 6.125 0 1 1 .915 10.296l-1.884.628a1.083 1.083 0 0 1-1.37-1.37l.63-1.882a6.125 6.125 0 0 1 1.708-7.672Zm4.048-.008a4.875 4.875 0 0 0-4.537 7.307c.09.155.109.341.052.511l-.61 1.823 1.825-.609a.625.625 0 0 1 .51.052 4.875 4.875 0 1 0 2.76-9.084Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
