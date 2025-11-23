/* eslint-disable string-quotes */
import escapeHtml from "escape-html";
import {Robot} from "phosphor-react";

// Hardcode Phosphor bot icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Robot;
/**
 * We use the bot icon for bot account avatars.
 *
 * This component is a modified version of the `phosphor-react` `<Robot>` icon.
 * 1. The eyes are slightly larger so that they look better at really small sizes.
 * 2. The mouth is a single line.
 * 3. The "antenna" is slightly wider.
 */
export function botIconSvg({
    color,
    style,
    strokeWidth,
}: {
    color: string;
    style: string;
    strokeWidth?: number;
}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-144 -144 400 400" style="${escapeHtml(
        style,
    )}">
        <path
            fill="${escapeHtml(color)}"
            stroke-opacity="1"
            stroke="${escapeHtml(color)}"
            stroke-width="${strokeWidth}"
            d="M200,48h-56v-24c0-8.8365-7.1635-16-16-16s-16,7.1635-16,16v24h-56c-17.6731,0-32,14.3269-32,32v112c0,17.6731,14.3269,32,32,32h144c17.6731,0,32-14.3269,32-32v-112c0-17.6731-14.3269-32-32-32ZM68,108c0-8.8365,7.1635-16,16-16s16,7.1635,16,16-7.1635,16-16,16-16-7.1635-16-16ZM160.27,170.7703c-19.7515,12.3129-44.7885,12.3129-64.54,0-3.739-2.3583-4.8582-7.301-2.4999-11.04,2.3582-3.739,7.301-4.8582,11.04-2.5,14.5341,9.0205,32.9258,9.0205,47.46,0,3.739-2.3582,8.6817-1.239,11.04,2.5,2.3583,3.739,1.239,8.6818-2.5,11.04ZM172,124c-8.8365,0-16-7.1635-16-16s7.1635-16,16-16,16,7.1635,16,16-7.1635,16-16,16Z"
        />
    </svg>
    `;
}
