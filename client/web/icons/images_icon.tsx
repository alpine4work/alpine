import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<Images>` icon is in Phosphor v2.
// Upgrading to v2 looks difficult so for now, inlining the SVG.
export function ImagesIcon({
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
            fill={color ?? contextColor}
            viewBox="0 0 256 256"
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <path fill="none" d="M0 0h256v256H0z" />
            <rect
                width={160}
                height={128}
                x={64}
                y={48}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                rx={8}
            />
            <circle cx={172} cy={84} r={12} />
            <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                d="m64 128.69 38.34-38.35a8 8 0 0 1 11.32 0L163.31 140 189 114.34a8 8 0 0 1 11.31 0L224 138.06"
            />
            <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                d="M192 176v24a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8V88a8 8 0 0 1 8-8h24"
            />
        </svg>
    );
}
