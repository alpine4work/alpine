import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The `<Notion>` icon is only in Phosphor
// v2. Upgrading to v2 looks difficult so for now, inlining the SVG.
export function NotionIcon({
    color,
    size,
    style,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
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
        >
            <rect width="256" height="256" fill="none" />
            <polyline
                points="40 48 64 48 152 208 192 208 192 48"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="16"
            />
            <line
                x1="40"
                y1="208"
                x2="88"
                y2="208"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="16"
            />
            <line
                x1="168"
                y1="48"
                x2="216"
                y2="48"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="16"
            />
            <polyline
                points="192 208 104 48 64 48 64 208"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="16"
            />
        </svg>
    );
}
