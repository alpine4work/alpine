/* eslint-disable string-quotes */

import escapeHtml from "escape-html";
import {Play} from "phosphor-react";

// Hardcode Phosphor play icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Play;

export const playIconSvg = ({
    className = "",
    weight = "regular",
}: {className?: string; weight?: "fill" | "regular"} = {}) =>
    weight === "fill"
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z" fill="currentColor"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M72,39.88V216.12a8,8,0,0,0,12.15,6.69l144.08-88.12a7.82,7.82,0,0,0,0-13.38L84.15,33.19A8,8,0,0,0,72,39.88Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
