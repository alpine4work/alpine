/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";
import {Plus} from "phosphor-react";

// Hardcode Phosphor plus icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Plus;

export const plusIconSvg = ({
    className = "",
    weight = "regular",
}: {className?: string; weight?: "bold" | "regular"} = {}) =>
    weight === "bold"
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><path d="M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z"></path></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
