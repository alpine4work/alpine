import {ReactNode, useContext, useMemo, useRef} from "react";
import {
    OverlaySinkContext,
    overlaySinkContextForTest,
    renderOverlayPortal,
} from "~/client/web/design/internal/overlay_sink_context.js";
import {RemLength} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Root overlay scope. Most have one of these at the root of the application.
 *
 * Generally you only want one root overlay scope at the root of your
 * application. However, there are some cases where it may make sense to have
 * nested root overlay scopes. For example, on mobile web when the keyboard
 * opens we shrink the viewport in `s.$spaceId.tsx` to the visible space above
 * the keyboard. (In our native mobile app we have different keyboard handling
 * with `--safe-area-inset-bottom`.) We want root overlays with `bottom: 0` to
 * be able to render above the keyboard instead of the space under the
 * keyboard.
 *
 * If `isDisabled` switches from `true` to `false` then we will continue using
 * the old portal elements for a single render then any existing root overlays
 * will unmount and remount into the new portal element.
 */
export function RootOverlayScopeContextProvider({
    isDisabled = false,
    children,
}: {
    isDisabled?: boolean;
    children?: ReactNode;
}) {
    const parentOverlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;

    const portalRef = useRef<HTMLDivElement>(null);
    const blockingPortalRef = useRef<HTMLDivElement>(null);
    const contextMenuBlockingPortalRef = useRef<HTMLDivElement>(null);

    const overlaySink = useMemo(
        (): OverlaySinkContext => ({
            getRootPortalElement: () =>
                portalRef.current ?? parentOverlaySink?.getRootPortalElement() ?? null,
            getBlockingPortalElement: () =>
                blockingPortalRef.current ?? parentOverlaySink?.getBlockingPortalElement() ?? null,
            // Unlike the root portal element and blocking portal element, the context menu
            // blocking portal element isn't overridden by nested
            // `<RootOverlayScopeContextProvider>`s.
            getContextMenuBlockingPortalElement: () =>
                parentOverlaySink?.getContextMenuBlockingPortalElement() ??
                contextMenuBlockingPortalRef.current,
            getPortalElement: () =>
                portalRef.current ?? parentOverlaySink?.getPortalElement() ?? null,
            insetLeft: null,
            insetRight: null,
        }),
        [parentOverlaySink],
    );

    return (
        <OverlaySinkContext.Provider
            value={
                !isDisabled
                    ? overlaySink
                    : assertExists(
                          parentOverlaySink,
                          "Expected a parent `<RootOverlayScopeContextProvider>` component",
                      )
            }
        >
            {children}
            {!isDisabled &&
                renderOverlayPortal(
                    // eslint-disable-next-line react-compiler/react-compiler
                    portalRef,
                )}
            {!isDisabled &&
                renderOverlayPortal(
                    // eslint-disable-next-line react-compiler/react-compiler
                    blockingPortalRef,
                    // Render at the absolute top of the page. Even over other overlays.
                    "70",
                )}
            {!isDisabled &&
                !parentOverlaySink &&
                renderOverlayPortal(
                    // eslint-disable-next-line react-compiler/react-compiler
                    contextMenuBlockingPortalRef,
                    // An additional blocking layer on top of our existing blocking layer.
                    "80",
                )}
        </OverlaySinkContext.Provider>
    );
}

/**
 * Child `<Overlay>` components will be rendered inside this component.
 *
 * Generally you want to render one of these inside every scrollable element.
 * That way the overlays naturally scroll with the element and can't render
 * outside the element. Otherwise when you scroll, overlays will follow the
 * scroll but the user will see stutter as it won't happen on the scroll
 * animation thread.
 *
 * See `useMobileWebKitKeyboardSupport()` for more information.
 */
export function OverlayScopeContextProvider({
    children,
    insetLeft,
    insetRight,
}: {
    children: ReactNode;
    insetLeft?: RemLength | number;
    insetRight?: RemLength | number;
}) {
    const parentOverlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(parentOverlaySink, "Expected a parent `<RootOverlayScopeContextProvider>` component");

    const portalRef = useRef<HTMLDivElement>(null);

    const overlaySink = useMemo(
        (): OverlaySinkContext => ({
            getRootPortalElement: parentOverlaySink.getRootPortalElement,
            getBlockingPortalElement: parentOverlaySink.getBlockingPortalElement,
            getContextMenuBlockingPortalElement:
                parentOverlaySink.getContextMenuBlockingPortalElement,
            getPortalElement: () => portalRef.current,
            insetLeft: insetLeft ?? null,
            insetRight: insetRight ?? null,
        }),
        [
            insetLeft,
            insetRight,
            parentOverlaySink.getBlockingPortalElement,
            parentOverlaySink.getContextMenuBlockingPortalElement,
            parentOverlaySink.getRootPortalElement,
        ],
    );

    return (
        <OverlaySinkContext.Provider value={overlaySink}>
            {children}
            {renderOverlayPortal(
                // eslint-disable-next-line react-compiler/react-compiler
                portalRef,
            )}
        </OverlaySinkContext.Provider>
    );
}
