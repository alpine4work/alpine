import {useContext, useEffect, useState} from "react";
import {
    OverlaySinkContext,
    overlaySinkContextForTest,
    overlayVisiblePoppers,
} from "~/client/web/design/internal/overlay_sink_context.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Get the current overlay portal element. This will be inside the nearest
 * `<OverlayScopeContextProvider>`.
 */
export function useOverlayPortalElement() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [portalElement, setPortalElement] = useState(overlaySink.getPortalElement);

    useEffect(() => {
        setPortalElement(overlaySink.getPortalElement);
    }, [overlaySink.getPortalElement]);

    return portalElement;
}

/**
 * Get the overlay portal element at the root of our app. We may have nested portal
 * overlay elements in, for instance, scroll views so overlays move with the scroll
 * view and can't escape.
 *
 * This allows you to portal into the root overlay element.
 */
export function useOverlayRootPortalElement() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [rootPortalElement, setRootPortalElement] = useState(overlaySink.getRootPortalElement);

    useEffect(() => {
        setRootPortalElement(overlaySink.getRootPortalElement);
    }, [overlaySink.getRootPortalElement]);

    return rootPortalElement;
}

/**
 * Get the _blocking_ overlay portal element at the root of our app. We may have
 * nested portal overlay elements in, for instance, scroll views so overlays move
 * with the scroll view and can't escape.
 */
export function useOverlayBlockingPortalElement() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [rootBlockingPortalElement, setRootBlockingPortalElement] = useState(
        overlaySink.getBlockingPortalElement,
    );

    useEffect(() => {
        setRootBlockingPortalElement(overlaySink.getBlockingPortalElement);
    }, [overlaySink.getBlockingPortalElement]);

    return rootBlockingPortalElement;
}

/**
 * If you have an `<Overlay>` element with a ref on the `overlay` prop then you
 * will not be able to access the ref until the overlay portal is ready. You may
 * use this hook for detecting this edge case.
 *
 * If your overlay's initial render is the same as the nearest
 * `<OverlayScopeContextProvider>`'s initial render and your overlay is initially
 * visible then this will start as `true` then return `false`. Otherwise this
 * always returns `false`.
 */
export function useIsWaitingForOverlayPortalElement(isVisible: boolean): boolean {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [isWaiting, setIsWaiting] = useState(() =>
        isVisible ? !overlaySink.getPortalElement() : false,
    );

    useEffect(() => {
        setIsWaiting(isVisible ? !overlaySink.getPortalElement() : false);
    }, [isVisible, overlaySink]);

    return isWaiting;
}

/**
 * Update the positions of all overlays that are direct descendants of the provided
 * element.
 */
export function forceUpdateAllChildOverlayPositions(element: Element) {
    for (const popper of overlayVisiblePoppers) {
        if (
            popper.state.elements.reference instanceof Element &&
            element.contains(popper.state.elements.reference)
        ) {
            popper.forceUpdate();
        }
    }
}
