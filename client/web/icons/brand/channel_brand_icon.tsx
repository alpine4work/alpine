import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/web/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const ChannelBrandIconMemo = memo(ChannelBrandIcon);
export {ChannelBrandIconMemo as ChannelBrandIcon};

function ChannelBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `orange-${shade}` as const),
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
                d="M5.75 6.41667C5.75 6.18654 5.93654 6 6.16667 6H19.7083C19.9385 6 20.125 6.18654 20.125 6.41667V16.8333C20.125 17.0635 19.9385 17.25 19.7083 17.25H6.16667C5.93654 17.25 5.75 17.0635 5.75 16.8333V6.41667Z"
                opacity={brandIconSplashColorOpacity}
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M.741 1.116A1.25 1.25 0 0 1 1.625.75h13.75A1.25 1.25 0 0 1 16.625 2v.75a.625.625 0 1 1-1.25 0V2H1.625v10.625h.625a.625.625 0 1 1 0 1.25h-.625a1.25 1.25 0 0 1-1.25-1.25V2c0-.332.132-.65.366-.884ZM16.5 16.25c-.925 0-1.683.611-1.896 1.41a.625.625 0 0 1-1.208-.32C13.757 15.982 15.02 15 16.5 15c1.482 0 2.743.983 3.104 2.34a.625.625 0 1 1-1.208.32c-.213-.799-.971-1.41-1.896-1.41Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M16.5 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM14 13.75a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0ZM10.649 16.25c-.925 0-1.684.611-1.896 1.41a.625.625 0 0 1-1.208-.32c.36-1.357 1.622-2.34 3.104-2.34a3.21 3.21 0 0 1 2.939 1.875h.362a.625.625 0 0 1 0 1.25h-.801a.625.625 0 0 1-.604-.464c-.213-.8-.972-1.411-1.896-1.411Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M10.648 12.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm-2.5 1.25a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M3.741 4.116a1.25 1.25 0 0 1 .884-.366h13.75A1.25 1.25 0 0 1 19.625 5v4.375a.625.625 0 1 1-1.25 0V5H4.625v10.625h1.25a.625.625 0 1 1 0 1.25h-1.25a1.25 1.25 0 0 1-1.25-1.25V5c0-.332.132-.65.366-.884Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M7.125 8.542c0-.345.28-.625.625-.625h5a.625.625 0 1 1 0 1.25h-5a.625.625 0 0 1-.625-.625Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
