import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// TODO(calebmer, #phosphor-v2): The `<PencilSimpleSlash>` icon is in Phosphor v2.
// Upgrading to v2 looks difficult so for now, inlining the SVG.
export function PencilSimpleSlashIcon({
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
            <path d="M53.92 34.62a8 8 0 1 0-11.84 10.76l48.2 53L36.68 152A15.89 15.89 0 0 0 32 163.31V208a16 16 0 0 0 16 16h44.69a15.86 15.86 0 0 0 11.31-4.69l50.4-50.39 47.69 52.46a8 8 0 1 0 11.84-10.76ZM92.69 208H48v-44.69l53.06-53 42.56 46.81ZM227.32 73.37l-44.69-44.68a16 16 0 0 0-22.63 0l-41.67 41.67a8 8 0 0 0 11.32 11.31l6.35-6.36L180.69 120l-9 9A8 8 0 0 0 183 140.34L227.32 96a16 16 0 0 0 0-22.63ZM192 108.69 147.32 64l24-24L216 84.69Z" />
        </svg>
    );
}
