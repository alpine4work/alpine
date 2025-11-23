import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<ColumnsPlusLeft>` icon is in
// Phosphor v2. Upgrading to v2 looks difficult so for now, inlining the SVG.
export function ColumnsPlusLeftIcon({
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
            <path d="M128 32h-24a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h24a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Zm0 176h-24V48h24Zm72-176h-24a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h24a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Zm0 176h-24V48h24ZM72 128a8 8 0 0 1-8 8H48v16a8 8 0 0 1-16 0v-16H16a8 8 0 0 1 0-16h16v-16a8 8 0 0 1 16 0v16h16a8 8 0 0 1 8 8Z" />
        </svg>
    );
}
