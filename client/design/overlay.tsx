import {createPopper} from "@popperjs/core";
import React, {
    ReactElement,
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {useElementWithRef} from "~/client/design/helpers/use-element-with-ref";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Where should the overlay content be placed relative to the target element?
 */
export type OverlayPlacement =
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "right"
    | "right-start"
    | "right-end"
    | "left"
    | "left-start"
    | "left-end";

/**
 * Renders an element above everything else on the page relative to some anchor
 * element. Useful for rendering tooltips, menus, and upsells.
 *
 * The overlay element is rendered in the nearest parent
 * `<OverlayScopeContextProvider>`. We typically render one of these elements at
 * the root of the app and in scroll views so that if we occlude an element
 * while scrolling, the overlay is also occluded.
 *
 * Uses [Popper][1] under the hood. That means you can depend on the existence
 * of attributes like `data-popper-placement` on the `overlay` element. You may
 * also use the attribute `data-popper-arrow` for placing an arrow to the
 * content.
 *
 * [1]: https://popper.js.org
 */
export function Overlay({
    isVisible: isActuallyVisible = false,
    placement,
    overlay: actualOverlay,
    children,
}: {
    /**
     * Is the overlay content visible? We default to the overlay content being
     * hidden.
     *
     * We can’t render overlay content on the server. That means if you want your
     * overlay to be visible immediately on page load it might flash in. To avoid
     * this, only render overlay in response to user interaction.
     */
    isVisible?: boolean;

    /**
     * Where should the overlay content be placed relative to the target element?
     *
     * If there’s not enough space on screen for this placement, then we will flip
     * the placement along the same axis.
     */
    placement: OverlayPlacement;

    /**
     * The overlay element to be positioned relative to the target element. Must
     * provide a ref to an HTML element or we will throw an error.
     */
    overlay: ReactElement;

    /**
     * The element our overlay content will be rendered around. Must
     * provide a ref to an HTML element or we will throw an error.
     */
    children: ReactElement;
}) {
    const overlaySink = useContext(OverlaySinkContext);
    assert(overlaySink);

    // Always hide overlays when we don’t yet have the portal element. This means
    // overlays can’t be rendered on the server.
    const isVisible = overlaySink.portalElement !== null && isActuallyVisible;

    const overlayRef = useRef<HTMLDivElement>(null);

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of `<Overlay>` to render an element with a ref to an HTML element",
            );

            if (!isVisible) return;

            assert(overlayRef.current);
            const overlayElement = overlayRef.current;

            const popper = createPopper(targetElement, overlayElement, {
                placement,
            });

            // Make sure Popper is positioned correctly. We find that sometimes after
            // parameter updates (e.g. `placement` changes), Popper won’t have the
            // right position.
            popper.forceUpdate();

            return () => {
                popper.destroy();
            };
        },
        [placement, isVisible],
    );

    const overlay = useElementWithRef(actualOverlay, overlayRef);

    return (
        <>
            {overlaySink.portalElement !== null &&
                isVisible &&
                // This intentionally comes before `children` so that React executes
                // `overlayRef` before `targetRef`.
                createPortal(overlay, overlaySink.portalElement)}
            {useElementWithRef(children, useLifecycleRef(targetLifecycleRef))}
        </>
    );
}

const OverlaySinkContext = createContext<{
    portalElement: HTMLDivElement | null;
} | null>(null);

/**
 * Child `<Overlay>` components will be rendered inside this component.
 */
export function OverlayScopeContextProvider({children}: {children: ReactNode}) {
    const portalRef = useRef<HTMLDivElement>(null);
    const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        assert(portalRef.current);
        setPortalElement(portalRef.current);
    }, []);

    return (
        <OverlaySinkContext.Provider value={useMemo(() => ({portalElement}), [portalElement])}>
            {children}
            <Box
                ref={portalRef}
                position="absolute"
                top="0"
                left="0"
                right="0"
                height="0"
                zIndex={10}
            />
        </OverlaySinkContext.Provider>
    );
}
