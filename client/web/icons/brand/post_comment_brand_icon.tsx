import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const PostCommentBrandIconMemo = memo(PostCommentBrandIcon);
export {PostCommentBrandIconMemo as PostCommentBrandIcon};

function PostCommentBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `orange-${shade}` as const),
    });

    const actualSize = size ? spacing[size] : (contextSize ?? spacing["5"]);

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
                d="M3.324 5.542c0-.23.187-.417.417-.417h13.542c.23 0 .416.187.416.417v10.416c0 .23-.186.417-.416.417H3.74a.417.417 0 0 1-.417-.417V5.542Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M.741 1.741a1.25 1.25 0 0 1 .884-.366h13.75a1.25 1.25 0 0 1 1.25 1.25v2.75a.625.625 0 1 1-1.25 0v-2.75H1.625V13.25H4.5a.625.625 0 1 1 0 1.25H1.625a1.25 1.25 0 0 1-1.25-1.25V2.625c0-.332.132-.65.366-.884Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M4.125 6.167c0-.345.28-.625.625-.625h4.5a.625.625 0 1 1 0 1.25h-4.5a.625.625 0 0 1-.625-.625ZM4.125 8.667c0-.345.28-.625.625-.625h2a.625.625 0 1 1 0 1.25h-2a.625.625 0 0 1-.625-.625ZM9.02 8.143a6.125 6.125 0 1 1 .915 10.296l-1.884.628a1.083 1.083 0 0 1-1.37-1.37l.63-1.882a6.125 6.125 0 0 1 1.708-7.672Zm4.048-.008a4.875 4.875 0 0 0-4.537 7.307c.09.155.109.341.052.511l-.61 1.823 1.825-.609a.625.625 0 0 1 .51.052 4.875 4.875 0 1 0 2.76-9.084Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
