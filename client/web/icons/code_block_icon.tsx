import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<CodeBlock>` icon is in Phosphor v2.
// Upgrading to v2 looks difficult so for now, inlining the SVG.
export function CodeBlockIcon({
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
            <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                d="M64 32 32 64l32 32M104 32l32 32-32 32M176 48h24a8 8 0 0 1 8 8v144a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8v-64"
            />
        </svg>
    );
}
