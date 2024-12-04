import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The `<Lecturn>` icon is only in Phosphor
// v2. Upgrading to v2 looks difficult so for now, inlining the SVG.
export function LecturnIcon({
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
            <path fill="none" d="M0 0h256v256H0z" />
            <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16}
                d="M24 136a8 8 0 0 1-7.16-11.58l40-80A8 8 0 0 1 64 40h128a8 8 0 0 1 7.16 4.42l40 80A8 8 0 0 1 232 136ZM72 104h112M128 136v80M96 216h64"
            />
        </svg>
    );
}
