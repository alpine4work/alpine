import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<RowsPlusBottom>` icon is in
// Phosphor v2. Upgrading to v2 looks difficult so for now, inlining the SVG.
export function RowsPlusBottomIcon({
    color,
    size,
    style,
    role,
    "aria-hidden": ariaHidden,
    "aria-label": ariaLabel,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
    role?: string;
    "aria-hidden"?: boolean;
    "aria-label"?: string;
}) {
    const {
        color: contextColor,
        size: contextSize,
        weight,
        mirrored,
        ...context
    } = useContext(IconContext);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 256 256"
            fill={color ?? contextColor}
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
            role={role}
            aria-hidden={ariaHidden}
            aria-label={ariaLabel}
        >
            <path d="M208 112H48a16 16 0 0 0-16 16v24a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16v-24a16 16 0 0 0-16-16Zm0 40H48v-24h160v24Zm0-112H48a16 16 0 0 0-16 16v24a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16Zm0 40H48V56h160v24Zm-48 136a8 8 0 0 1-8 8h-16v16a8 8 0 0 1-16 0v-16h-16a8 8 0 0 1 0-16h16v-16a8 8 0 0 1 16 0v16h16a8 8 0 0 1 8 8Z" />
        </svg>
    );
}
