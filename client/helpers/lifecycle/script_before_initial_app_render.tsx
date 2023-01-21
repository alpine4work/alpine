import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {assert} from "~/shared/helpers/control/assert";
import {SafeString, isSafeString} from "~/shared/helpers/string/safe_string";

/**
 * Embeds a `<script>` element in the DOM that executes immediately and
 * synchronously once server side rendering has put it in the DOM.
 *
 * If you need a little bit of JavaScript after server side rendering to make
 * sure the application looks correct (e.g. adjusting a scroll position) then
 * use this component.
 *
 * We recommend your script be a single line string to keep the SSR
 * output clean.
 */
export function ScriptBeforeAppInitialRender({script}: {script: SafeString}) {
    const isInitialAppRender = useIsInitialAppRender();
    if (!isInitialAppRender) return null;

    assert(isSafeString(script));

    return <script dangerouslySetInnerHTML={{__html: script.string}} />;
}
