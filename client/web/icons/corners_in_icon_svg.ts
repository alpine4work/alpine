/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";
import {CornersIn} from "phosphor-react";

// Hardcode Phosphor corners out icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
CornersIn;

export const cornersInIconSvg = ({className = ""}: {className?: string} = {}) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
        className,
    )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="208 96 160 96 160 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="48 160 96 160 96 208" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="160 208 160 160 208 160" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="96 48 96 96 48 96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
