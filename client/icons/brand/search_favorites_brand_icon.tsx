import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const SearchFavoritesBrandIconMemo = memo(SearchFavoritesBrandIcon);
export {SearchFavoritesBrandIconMemo as SearchFavoritesBrandIcon};

function SearchFavoritesBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `orange-${shade}` as const),
        opacity: brandIconSplashColorOpacity,
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
                d="m18.974 11.075-3.165 2.73.964 4.084a1.153 1.153 0 0 1-1.722 1.253L11.5 16.956l-3.553 2.186a1.154 1.154 0 0 1-1.72-1.253l.967-4.083-3.164-2.73a1.157 1.157 0 0 1 .655-2.03l4.149-.334 1.6-3.873a1.15 1.15 0 0 1 2.128 0l1.6 3.873 4.149.335a1.157 1.157 0 0 1 .658 2.03l.005-.002Z"
            />
            <path
                fill={color}
                d="M18.686 7.598a1.28 1.28 0 0 0-1.114-.88l-4.61-.371-1.78-4.304a1.277 1.277 0 0 0-2.364 0L7.04 6.346l-4.612.373a1.286 1.286 0 0 0-.732 2.254l3.516 3.034-1.071 4.536a1.28 1.28 0 0 0 1.914 1.392L10 15.507l3.948 2.428a1.281 1.281 0 0 0 1.911-1.392l-1.075-4.537L18.3 8.973a1.284 1.284 0 0 0 .386-1.375Zm-1.198.428-3.805 3.281a.625.625 0 0 0-.2.618l1.162 4.906a.029.029 0 0 1 .001.022.028.028 0 0 1-.014.016c-.014.01-.018.008-.03 0l-4.275-2.63a.625.625 0 0 0-.654 0L5.398 16.87c-.012.007-.015.01-.03 0a.029.029 0 0 1-.013-.038l1.162-4.905a.625.625 0 0 0-.2-.618L2.513 8.027c-.01-.007-.018-.014-.01-.039.007-.024.013-.02.025-.022l4.994-.404a.625.625 0 0 0 .525-.385L9.97 2.52c.007-.014.009-.02.028-.02.018 0 .02.006.027.02l1.928 4.657a.626.626 0 0 0 .527.384l4.994.403c.012 0 .019 0 .026.023.007.022 0 .031-.012.039Z"
            />
        </svg>
    );
}
