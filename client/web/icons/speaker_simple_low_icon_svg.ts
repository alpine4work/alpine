/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";

// Hardcode Phosphor speaker-simple-low icon SVG.
// This is since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.

export const speakerSimpleLowIconSvg = ({className = ""}: {className?: string} = {}) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
        className,
    )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M88,168H40a8,8,0,0,1-8-8V96a8,8,0,0,1,8-8H88l72-56V224Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="200" y1="104" x2="200" y2="152" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
