import {Instance, Rect, createPopper} from "@popperjs/core";
import React, {
    ReactElement,
    ReactNode,
    Ref,
    createContext,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {getRemPx} from "~/client/design/helpers/get-rem-px";
import {useElementWithRef} from "~/client/design/helpers/use-element-with-ref";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
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
    | "left-end"
    | "center";

export type OverlayRef = {
    /**
     * Force the overlay to update its position.
     */
    forceUpdateOverlayPosition(): void;
};

const OverlayForwardRef = forwardRef(Overlay);
export {OverlayForwardRef as Overlay};

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
function Overlay(
    {
        visible: actuallyVisible = false,
        placement,
        overlay: actualOverlay,
        offsetAway,
        offsetAlong,
        preventOverflow = true,
        flip = true,
        sameWidth = false,
        sameHeight = false,
        children,
    }: {
        /**
         * Is the overlay content visible? We default to the overlay content being
         * hidden.
         *
         * We can't render overlay content on the server. That means if you want your
         * overlay to be visible immediately on page load it might flash in. To avoid
         * this, only render overlay in response to user interaction.
         */
        visible?: boolean;

        /**
         * Where should the overlay content be placed relative to the target element?
         *
         * If there's not enough space on screen for this placement, then we will flip
         * the placement along the same axis.
         */
        placement: OverlayPlacement;

        /**
         * The overlay element to be positioned relative to the target element. Must
         * provide a ref to an HTML element or we will throw an error.
         */
        overlay: ReactElement;

        /**
         * How far away the offset should be from the reference.
         *
         * See the [demo][1] here.
         *
         * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
         */
        offsetAway?: Spacing;

        /**
         * How far the offset should move along the reference.
         *
         * See the [demo][1] here.
         *
         * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
         */
        offsetAlong?: Spacing | `-${Spacing}`;

        /**
         * If true, the overlay tries to stay visible within the nearest parent
         * `<OverlayScopeContextProvider>`.
         *
         * Defaults to `true`.
         */
        preventOverflow?: boolean;

        /**
         * If true, changes the `placement` of a popper to make sure it stays visible
         * within the nearest parent `<OverlayScopeContextProvider>`.
         *
         * Defaults to `true`.
         */
        flip?: boolean;

        /**
         * Makes the overlay width the same width as the content the overlay is
         * attached to.
         *
         * Defaults to `false`.
         */
        sameWidth?: boolean;

        /**
         * Makes the overlay height the same height as the content the overlay is
         * attached to.
         *
         * Defaults to `false`.
         */
        sameHeight?: boolean;

        /**
         * The element our overlay content will be rendered around. Must
         * provide a ref to an HTML element or we will throw an error.
         */
        children: ReactElement;
    },
    ref: Ref<OverlayRef>,
) {
    const overlaySink = useContext(OverlaySinkContext);
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    // Always hide overlays when we don't yet have the portal element. This means
    // overlays can't be rendered on the server.
    const visible = overlaySink.portalElement !== null && actuallyVisible;

    const overlayRef = useRef<HTMLDivElement>(null);
    const popperRef = useRef<Instance | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            forceUpdateOverlayPosition: () => {
                popperRef.current?.forceUpdate();
            },
        }),
        [],
    );

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of `<Overlay>` to render an element with a ref to an HTML element",
            );

            if (!visible) return;

            assert(overlayRef.current);
            const overlayElement = overlayRef.current;

            const remPx = getRemPx();

            const popper = createPopper(targetElement, overlayElement, {
                placement: placement === "center" ? "top-start" : placement,
                modifiers: [
                    {
                        name: "preventOverflow",
                        enabled: preventOverflow,
                    },
                    {
                        name: "flip",
                        enabled: flip && placement !== "center",
                    },
                    // When placing in the center, add a custom offset modifier that positions the
                    // overlay on top of the element underneath.
                    placement === "center"
                        ? {
                              name: "offset",
                              enabled: true,
                              options: {
                                  offset: ({
                                      reference,
                                      popper,
                                  }: {
                                      reference: Rect;
                                      popper: Rect;
                                  }) => {
                                      return [
                                          reference.width / 2 - popper.width / 2,
                                          -popper.height / 2 - reference.height / 2,
                                      ];
                                  },
                              },
                          }
                        : {
                              name: "offset",
                              enabled: true,
                              options: {
                                  offset: [
                                      offsetAlong
                                          ? offsetAlong.startsWith("-")
                                              ? -convertRemLengthToPx(
                                                    spacing[offsetAlong.slice(1) as Spacing],
                                                    remPx,
                                                )
                                              : convertRemLengthToPx(
                                                    spacing[offsetAlong as Spacing],
                                                    remPx,
                                                )
                                          : 0,
                                      offsetAway
                                          ? convertRemLengthToPx(spacing[offsetAway], remPx)
                                          : 0,
                                  ],
                              },
                          },
                    {
                        name: "sameWidth",
                        enabled: sameWidth,
                        phase: "beforeWrite",
                        requires: ["computeStyles"],
                        fn: ({state}) => {
                            state.styles.popper!.width = `${state.rects.reference.width}px`;
                        },
                        effect: ({state}) => {
                            state.elements.popper.style.width = `${
                                (state.elements.reference as HTMLElement).offsetWidth
                            }px`;
                        },
                    },
                    {
                        name: "sameHeight",
                        enabled: sameHeight,
                        phase: "beforeWrite",
                        requires: ["computeStyles"],
                        fn: ({state}) => {
                            state.styles.popper!.height = `${state.rects.reference.height}px`;
                        },
                        effect: ({state}) => {
                            state.elements.popper.style.height = `${
                                (state.elements.reference as HTMLElement).offsetHeight
                            }px`;
                        },
                    },
                ],
            });

            popperRef.current = popper;

            // Make sure Popper is positioned correctly. We find that sometimes after
            // parameter updates (e.g. `placement` changes), Popper won't have the
            // right position.
            popper.forceUpdate();

            return () => {
                popperRef.current = null;
                popper.destroy();
            };
        },
        [visible, placement, preventOverflow, flip, offsetAway, offsetAlong, sameWidth, sameHeight],
    );

    const overlay = useElementWithRef(actualOverlay, overlayRef);

    return (
        <>
            {overlaySink.portalElement !== null &&
                visible &&
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
