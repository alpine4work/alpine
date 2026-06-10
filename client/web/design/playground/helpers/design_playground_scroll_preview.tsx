import React, {ReactNode, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {safe} from "~/shared/helpers/string/safe_string.js";

export function DesignPlaygroundScrollPreview({
    shouldRenderOverlaysInDocumentBody,
    children,
}: {
    shouldRenderOverlaysInDocumentBody: boolean;
    children: ReactNode;
}) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // On mount, center the scroller such that the content element is centered.
    //
    // Safe because we also have a `<script>` that executes this logic before React
    // hydrates.
    useLayoutEffectWithoutServerSideWarning(() => {
        assert(scrollerRef.current);
        assert(contentRef.current);

        scrollerRef.current.scrollTop =
            contentRef.current.offsetTop -
            scrollerRef.current.clientHeight / 2 +
            contentRef.current.clientHeight / 2;

        scrollerRef.current.scrollLeft =
            contentRef.current.offsetLeft -
            scrollerRef.current.clientWidth / 2 +
            contentRef.current.clientWidth / 2;
    }, []);

    const content = (
        <div ref={contentRef}>
            <ScriptBeforeAppInitialRender
                // Center the scrollable element so that the content element is centered on initial
                // render.
                script={safe`var content = document.currentScript.parentNode; var scroller = content.parentNode.parentNode; scroller.scrollTop = content.offsetTop - scroller.clientHeight / 2 + content.clientHeight / 2; scroller.scrollLeft = content.offsetLeft - scroller.clientWidth / 2 + content.clientWidth / 2;`}
            />
            {children}
        </div>
    );

    return (
        <Box
            ref={useMergedRefs(scrollerRef, useScrollbar())}
            position="relative"
            width="full"
            height="128"
            border="grey-10"
            borderRadius="1"
            overflow="scroll"
        >
            <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                position="relative"
                style={{width: "128rem", height: "128rem"}}
            >
                {shouldRenderOverlaysInDocumentBody ? (
                    content
                ) : (
                    <OverlayScopeContextProvider>{content}</OverlayScopeContextProvider>
                )}
            </Box>
        </Box>
    );
}
