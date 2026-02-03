/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";
import {Check} from "phosphor-react";

// Hardcode Phosphor check icon SVG since we don't want to mount a React root
// for every checkbox. And since we need to generate HTML without React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Check;

export const checkIconSvg = ({
    // Only the `bold` weight is supported right now.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    weight,
    className = "",
    style,
}: {
    weight: "bold";
    className?: string;
    style?: string;
}) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(className)}"${
        style !== undefined ? ` style="${escapeHtml(style)}"` : ""
    } viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="216 72 104 184 48 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/></svg>`;
