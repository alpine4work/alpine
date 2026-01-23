import {CSSProperties, JSX, Ref, createElement, useRef} from "react";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlElementGenerator, HtmlGenerator} from "~/shared/helpers/html/html_generator.js";

/**
 * Takes an `HtmlElementGenerator` and integrates it with React. If the
 * component re-renders with a new `HtmlElementGenerator` then we'll use
 * `patchNode()` to update the DOM.
 */
// TODO(calebmer): `content_file_preview_component.tsx` and
// `content_file_entity_preview_component.tsx` should use this component. Those
// two files implement effectively the same logic plus some other stuff.
export function HtmlGeneratorView({
    ref = null,
    as = "div",
    className,
    style,
    htmlGenerator,
}: {
    ref?: Ref<HTMLElement | null>;
    as?: keyof JSX.IntrinsicElements;
    className?: string;
    style?: CSSProperties;
    htmlGenerator: HtmlElementGenerator;
}) {
    const isInitialAppRender = useIsInitialAppRender();

    const containerRef = useRef<HTMLElement>(null);
    const previousHtmlGeneratorRef = useRef<HtmlGenerator>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const previousHtmlGenerator = previousHtmlGeneratorRef.current;
        previousHtmlGeneratorRef.current = htmlGenerator;

        if (previousHtmlGenerator === htmlGenerator) return;

        if (!previousHtmlGenerator) {
            // This case happens during a hot reload. We need to remove the children
            // currently in the DOM.
            while (containerElement.hasChildNodes()) {
                containerElement.firstChild!.remove();
            }

            containerElement.appendChild(htmlGenerator.generateNode());
        } else {
            assert(
                htmlGenerator.patchNode(
                    previousHtmlGenerator,
                    assertExists(containerElement.firstElementChild),
                ),
            );
        }
    }, [htmlGenerator, isInitialAppRender]);

    return createElement(as, {
        ref: useMergedRefs(ref, containerRef),
        className,
        style,
        dangerouslySetInnerHTML: isInitialAppRender
            ? {__html: htmlGenerator.generateHtml()}
            : undefined,
    });
}
