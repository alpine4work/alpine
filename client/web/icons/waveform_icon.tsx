import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The updated `<Waveform>` icon is in Phosphor v2.
// Upgrading to v2 looks difficult so for now, inlining the SVG.
export function WaveformIcon({
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
                d="M48 96v64M88 32v192M128 64v128M168 96v64M208 80v96"
            />
        </svg>
    );
}
