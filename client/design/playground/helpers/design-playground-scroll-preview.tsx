import React, {ReactNode, useRef} from "react";
import {Box} from "~/client/design/box";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script-before-initial-app-render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use-layout-effect-without-server-side-warning";
import {assert} from "~/shared/helpers/control/assert";
import {safe} from "~/shared/helpers/string/safe-string";

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
    // Safe because we also have a `<script>` that executes this logic before
    // React hydrates.
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
                // Center the scrollable element so that the content element is centered on
                // initial render.
                script={safe`var content = document.currentScript.parentNode; var scroller = content.parentNode.parentNode; scroller.scrollTop = content.offsetTop - scroller.clientHeight / 2 + content.clientHeight / 2; scroller.scrollLeft = content.offsetLeft - scroller.clientWidth / 2 + content.clientWidth / 2;`}
            />
            {children}
        </div>
    );

    return (
        <Box
            ref={scrollerRef}
            width="full"
            height="128"
            border="grey-30"
            borderRadius="base"
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
