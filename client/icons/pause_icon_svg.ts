/* eslint-disable string-quotes */

import escapeHtml from "escape-html";
import {Pause} from "phosphor-react";

// Hardcode Phosphor pause icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Pause;

export const pauseIconSvg = ({
    className = "",
    weight = "regular",
}: {className?: string; weight?: "fill" | "regular"} = {}) =>
    weight === "fill"
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z" fill="currentColor"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><rect x="152" y="40" width="56" height="176" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><rect x="48" y="40" width="56" height="176" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
