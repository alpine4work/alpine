import dedent from "dedent";
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
 *
 * This component needs to be a little more complicated than a single `<script>`
 * because Next.js uses `style-loader` in development which means we don't get
 * CSS until the JavaScript bundle loads. So [to avoid a flash of unstyled
 * content][1], Next.js adds `display: none` to the page until the JavaScript
 * bundle loads and adds the CSS. This script component waits for that to happen
 * before executing your code.
 *
 * [1]: https://github.com/vercel/next.js/blob/197d46ddb9bebc4a74360e66f50b091edd811ae0/packages/next/client/dev/fouc.js
 */
export function ScriptBeforeAppInitialRender({script}: {script: SafeString}) {
    const isInitialAppRender = useIsInitialAppRender();
    if (!isInitialAppRender) return null;

    assert(isSafeString(script));

    if (process.env.NODE_ENV === "development") {
        return (
            <script
                dangerouslySetInnerHTML={{
                    __html: dedent`
                        var documentCurrentScript = document.currentScript;

                        function run() {
                            var lastOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(document, 'currentScript');
                            Object.defineProperty(document, 'currentScript', {value: documentCurrentScript, configurable: true});
                            try {
                        ${script.string}
                            } finally {
                                if (lastOwnPropertyDescriptor) {
                                    Object.defineProperty(document, 'currentScript', lastOwnPropertyDescriptor);
                                } else {
                                    delete document.currentScript;
                                }
                            }
                        }

                        var observer = new MutationObserver(function(mutationList) {
                            var hasChildListMutation = false;
                            for (var i = 0; i < mutationList.length; i++) {
                                if (mutationList[i].type === "childList") {
                                    hasChildListMutation = true;
                                    break;
                                }
                            }
                            if (hasChildListMutation && document.querySelectorAll("[data-next-hide-fouc]").length === 0) {
                                observer.disconnect();
                                run();
                            }
                        });

                        var foucElements = document.querySelectorAll("[data-next-hide-fouc]");
                        if (foucElements.length === 0) {
                            run();
                        } else {
                            for (var i = 0; i < foucElements.length; i++) {
                                observer.observe(foucElements[i].parentNode, {childList: true});
                            }
                        }
                    `,
                }}
            />
        );
    } else {
        return <script dangerouslySetInnerHTML={{__html: script.string}} />;
    }
}
