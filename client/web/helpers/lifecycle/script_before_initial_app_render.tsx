import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SafeString, isSafeString} from "~/shared/helpers/string/safe_string.js";

/**
 * Embeds a `<script>` element in the DOM that executes immediately and
 * synchronously once server side rendering has put it in the DOM.
 *
 * If you need a little bit of JavaScript after server side rendering to make sure
 * the application looks correct (e.g. adjusting a scroll position) then use this
 * component.
 *
 * We recommend your script be a single line string to keep the SSR output clean.
 *
 * We require you to use a `SafeString` to protect against XSS injection. A
 * `SafeString` is guaranteed to only use constants from our code and never have
 * user input.
 */
export function ScriptBeforeAppInitialRender({script}: {script: SafeString | (() => SafeString)}) {
    const isInitialAppRender = useIsInitialAppRender();
    if (!isInitialAppRender) return null;

    if (typeof script === "function") {
        script = script();
    }

    // Double check to make sure an attacker didn't sneak in a JSON object.
    assert(isSafeString(script));

    return <script dangerouslySetInnerHTML={{__html: script.string}} />;
}
