import {useEffect} from "react";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {safe, safeAlphanumericString} from "~/shared/helpers/string/safe_string.js";

/**
 * Manages the theme color for the page by setting the data-theme attribute on the
 * document element based on the space's theme color setting.
 *
 * Contains a script that synchronously initializes the theme color on the `<html>`
 * element during server-side rendering. This prevents a flash of the default theme
 * color before React hydrates.
 *
 * Also subscribes to theme color changes via useEffect for client-side updates
 * when navigating between spaces.
 *
 * Should be placed inside a space context provider.
 */
export function SpaceThemeColorManager() {
    const {space} = useSpaceContext();

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", space.themeColor);
    }, [space.themeColor]);

    // Render an inline script that sets the theme color attribute synchronously. This
    // runs before React hydrates, preventing a flash of the default theme.
    return (
        <ScriptBeforeAppInitialRender
            // eslint-disable-next-line cyberworlds/string-quotes
            script={safe`document.documentElement.setAttribute("data-theme","${safeAlphanumericString(space.themeColor)}");`}
        />
    );
}
