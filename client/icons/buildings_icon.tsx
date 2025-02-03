import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<Buildings>` icon is in Phosphor
// v2. Upgrading to v2 looks difficult so for now, inlining the SVG.
export function BuildingsIcon({
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
            <path fill="none" d="M0 0h256v256H0z" />
            <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                d="M136 216V32a8 8 0 0 0-12.44-6.65l-80 53.33A8 8 0 0 0 40 85.35V216M136 88h72a8 8 0 0 1 8 8v120M16 216h224M104 112v16M72 112v16M72 168v16M104 168v16"
            />
        </svg>
    );
}
