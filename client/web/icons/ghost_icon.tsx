import {CSSProperties} from "react";

/**
 * We use the ghost icon for removed account avatars.
 *
 * This component is a modified version of the `phosphor-react` `<Ghost>` icon.
 * The eyes are slightly bigger so that they look better at really small sizes.
 */
export function GhostIcon({
    color,
    style,
    strokeWidth,
}: {
    color: string;
    style: CSSProperties;
    strokeWidth?: number;
}) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="-144 -144 400 400" style={style}>
            <path
                fill={color}
                strokeOpacity={1}
                stroke={color}
                strokeWidth={strokeWidth}
                d="M128,24c-52.9942.0606-95.9394,43.0058-96,96v96c-.0009,4.4183,3.58,8.0007,7.9983,8.0017,1.8492.0004,3.6414-.6398,5.0717-1.8117l24.26-19.85,24.27,19.85c2.9467,2.4102,7.1834,2.4102,10.13,0l24.27-19.85,24.27,19.85c2.9466,2.4102,7.1834,2.4102,10.13,0l24.27-19.85,24.2599,19.85c3.4177,2.8,8.4583,2.2994,11.2583-1.1183,1.1719-1.4304,1.8121-3.2225,1.8117-5.0717v-96c-.0606-52.9942-43.0058-95.9394-96-96ZM100,132c-8.8365,0-16-7.1635-16-16s7.1635-16,16-16,16,7.1635,16,16-7.1635,16-16,16ZM156,132c-8.8365,0-16-7.1635-16-16s7.1635-16,16-16,16,7.1635,16,16-7.1635,16-16,16Z"
            />
        </svg>
    );
}
