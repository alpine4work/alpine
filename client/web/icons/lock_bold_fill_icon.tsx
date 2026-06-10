import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

/**
 * The Phosphor `<Lock>` icon with a fill weight but line thickness from the bold
 * weight. Looks better next to text than fill or bold alone.
 */
export function LockBoldFillIcon({
    color,
    size,
    className,
    style,
    "aria-label": ariaLabel,
}: {
    color?: string;
    size?: string | number;
    className?: string;
    style?: CSSProperties;
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
            version="1.1"
            viewBox="0 0 256 256"
            fill={color ?? contextColor}
            role={ariaLabel ? "img" : undefined}
            aria-label={ariaLabel}
            {...context}
            className={className}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <path d="M208,80h-32v-28c0-26.4673-21.5322-48-48-48s-48,21.5327-48,48v28h-32c-8.8365,0-16,7.1635-16,16v112c0,8.8365,7.1635,16,16,16h160c8.8365,0,16-7.1635,16-16v-112c0-8.8365-7.1635-16-16-16ZM128,168c-8.8365,0-16-7.1635-16-16s7.1635-16,16-16,16,7.1635,16,16-7.1635,16-16,16ZM152,80h-48v-28c0-13.2339,10.7661-24,24-24s24,10.7661,24,24v28Z" />
        </svg>
    );
}
