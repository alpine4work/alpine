import {IconContext} from "phosphor-react";
import {memo, useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const TaskQueryBrandIconMemo = memo(TaskQueryBrandIcon);
export {TaskQueryBrandIconMemo as TaskQueryBrandIcon};

function TaskQueryBrandIcon({size}: {size?: Spacing}) {
    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(brandIconSplashColorShade, shade => `green-${shade}` as const),
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
                d="M6.25 5.52h11.667v12.084c0 .92-.747 1.667-1.667 1.667H7.917c-.92 0-1.667-.746-1.667-1.667V5.521Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M8.457 8.375h10.085a1.086 1.086 0 0 1 .99.641 1.076 1.076 0 0 1-.19 1.166l-.007.008-3.835 4.059v3.084a1.078 1.078 0 0 1-.485.9l-1.833 1.212a1.086 1.086 0 0 1-1.683-.898v-4.298l-3.84-4.066a1.078 1.078 0 0 1 .797-1.808h.001Zm.394 1.25 3.728 3.946c.11.116.17.27.17.43v4.231l1.5-.991V14c0-.16.062-.314.171-.43l3.729-3.946H8.85Zm3.641 8.777Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M3.125 3.125c0-.345.28-.625.625-.625h12.5c.345 0 .625.28.625.625V6.25a.625.625 0 1 1-1.25 0v-2.5H4.375v11.875a1.25 1.25 0 0 0 1.25 1.25H9.25a.625.625 0 1 1 0 1.25H5.625a2.5 2.5 0 0 1-2.5-2.5v-12.5Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M6.25 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM10 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM13.75 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
