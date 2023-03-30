import {Instance, Rect, createPopper} from "@popperjs/core";
import {
    ReactElement,
    ReactNode,
    Ref,
    createContext,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer";
import {useStableJsonValue} from "~/client/helpers/use_stable_json_value";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {noop} from "~/shared/helpers/control/noop";
import {sprinkles} from "~/shared/styles/styles";

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

export type OverlayProps = {
    /**
     * Is the overlay content visible? We default to the overlay content being
     * hidden.
     *
     * We can't render overlay content on the server. That means if you want your
     * overlay to be visible immediately on page load it might flash in. To avoid
     * this, only render overlay in response to user interaction.
     */
    isVisible?: boolean;

    /**
     * Where should the overlay content be placed relative to the target element?
     */
    placement: OverlayPlacement;

    /**
     * Placements to try if `placement` would put the overlay out of bounds. If
     * it's an empty array then the overlay will never flip from `placement`.
     *
     * If undefined the overlay can flip anywhere.
     *
     * Does not work with the special `center` placement.
     */
    fallbackPlacements?: ReadonlyArray<OverlayPlacement>;

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
    offset?: Spacing | `-${Spacing}`;

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
     *
     * Can not provided this prop and `targetElement`.
     */
    children?: ReactElement;

    /**
     * The element our overlay content will be rendered next to. Use this prop when
     * the element you're targeting is not managed by React. Otherwise prefer
     * `children`.
     *
     * Can not provide this prop and `children`.
     */
    targetElement?: HTMLElement;
};

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
        isVisible: actuallyIsVisible = false,
        placement,
        fallbackPlacements: _fallbackPlacements,
        overlay: actualOverlay,
        offset,
        offsetAlong,
        preventOverflow = true,
        sameWidth = false,
        sameHeight = false,
        children,
        targetElement,
    }: OverlayProps,
    ref: Ref<OverlayRef>,
) {
    assert(
        (children && !targetElement) || (targetElement && !children),
        "Can not provide both a `children` prop and `targetElement` prop to `<Overlay>`",
    );

    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    // Always hide overlays when we don't yet have the portal element. This means
    // overlays can't be rendered on the server.
    const isVisible = overlaySink.portalElement !== null && actuallyIsVisible;
    const fallbackPlacements = useStableJsonValue(_fallbackPlacements ?? null);

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

    const defaultTargetElementId = useId();

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of an `<Overlay>` component to render an element with a ref to an HTML element",
            );

            if (!isVisible) return;

            assert(
                overlayRef.current && overlayRef.current instanceof HTMLElement,
                "Expected the overlay prop of an `<Overlay>` component to render an element with a ref to an HTML element",
            );
            const overlayElement = overlayRef.current;

            // Getting the value of 1rem without subscribing so that all our `<Overlay>`
            // components don't need to re-render after the initial render.
            const remPx = getRemPxWithoutListening();

            const popper = createPopper(targetElement, overlayElement, {
                placement: placement === "center" ? "top-start" : placement,
                modifiers: [
                    {
                        name: "preventOverflow",
                        enabled: preventOverflow,
                        options: {
                            padding: convertRemLengthToPx(spacing["1"], remPx),
                        },
                    },
                    {
                        name: "flip",
                        enabled: placement !== "center",
                        options: {fallbackPlacements},
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
                                      // This seems to be running before the `sameWidth` and `sameHeight` plugin so
                                      // our `popper` rect hasn't updated. Instead we can hardcode similar
                                      // logic here.
                                      return [
                                          reference.width / 2 -
                                              (sameWidth ? reference.width : popper.width) / 2,
                                          -(sameHeight ? reference.height : popper.height) / 2 -
                                              reference.height / 2,
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
                                      offset
                                          ? offset.startsWith("-")
                                              ? -convertRemLengthToPx(
                                                    spacing[offset.slice(1) as Spacing],
                                                    remPx,
                                                )
                                              : convertRemLengthToPx(
                                                    spacing[offset as Spacing],
                                                    remPx,
                                                )
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

            // Update the overlay placement if the target element resizes.
            const handleResize = () => popper.forceUpdate();
            addResizeListenerForElement(targetElement, handleResize);

            const originalTargetElementId = targetElement.id;
            const cleanupTargetElementAttributes = !originalTargetElementId
                ? setElementAttributesWithCleanup(targetElement, {id: defaultTargetElementId})
                : noop;

            const cleanupOverlayElementAttributes = setElementAttributesWithCleanup(
                overlayElement,
                {
                    "data-ownedby": originalTargetElementId
                        ? originalTargetElementId
                        : defaultTargetElementId,
                },
            );

            return () => {
                popperRef.current = null;
                popper.destroy();
                removeResizeListenerForElement(targetElement, handleResize);
                cleanupTargetElementAttributes();
                cleanupOverlayElementAttributes();
            };
        },
        [
            isVisible,
            placement,
            preventOverflow,
            fallbackPlacements,
            offsetAlong,
            offset,
            sameWidth,
            sameHeight,
            defaultTargetElementId,
        ],
    );

    const overlay = useElementWithRef(actualOverlay, overlayRef);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!targetElement) return;
        return targetLifecycleRef(targetElement);
    }, [targetElement, targetLifecycleRef]);

    // Update popper every React re-render.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isVisible) return;
        // Run in a microtask so that parent effects run before we update the
        // popper position.
        scheduleMicrotask(() => {
            popperRef.current?.forceUpdate();
        });
    });

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
    rootPortalElement: HTMLDivElement | null;
    portalElement: HTMLDivElement | null;
} | null>(null);

/**
 * Child `<Overlay>` components will be rendered inside this component.
 *
 * Generally you want to render one of these inside every scrollable element.
 * That way the overlays naturally scroll with the element and can't render
 * outside the element.
 */
export function OverlayScopeContextProvider({children}: {children: ReactNode}) {
    const parentOverlaySink = useContext(OverlaySinkContext);
    const portalRef = useRef<HTMLDivElement>(null);
    const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        assert(portalRef.current);
        setPortalElement(portalRef.current);
    }, []);

    return (
        <OverlaySinkContext.Provider
            value={useMemo(
                () => ({
                    rootPortalElement: parentOverlaySink?.rootPortalElement ?? portalElement,
                    portalElement,
                }),
                [parentOverlaySink?.rootPortalElement, portalElement],
            )}
        >
            {children}
            <Box
                ref={portalRef}
                position="absolute"
                top="0"
                left="0"
                right="0"
                // The root portal element has a height of 0 because when you use it in a
                // nested scroll view we don't want the overlay height to extend from the top
                // to the bottom of the nested scroll view.
                height="0"
                // Render above anything on the page.
                zIndex="50"
            />
        </OverlaySinkContext.Provider>
    );
}

// In Jest tests, create a portal element in the JSDOM `<body>`.
const overlaySinkContextForTest =
    typeof jest !== "undefined"
        ? (() => {
              const portalElement = document.createElement("div");

              portalElement.className = sprinkles({
                  position: "absolute",
                  top: "0",
                  left: "0",
                  right: "0",
                  // The root portal element has a height of 0 because when you use it in a
                  // nested scroll view we don't want the overlay height to extend from the top
                  // to the bottom of the nested scroll view.
                  height: "0",
                  // Render above anything on the page.
                  zIndex: "50",
              });

              document.body.appendChild(portalElement);

              return {
                  rootPortalElement: portalElement,
                  portalElement,
              };
          })()
        : null;

/**
 * Get the overlay portal element at the root of our app. We may have nested
 * portal overlay elements in, for instance, scroll views so overlays move with
 * the scroll view and can't escape.
 *
 * This allows you to portal into the root overlay element.
 */
export function useOverlayRootPortalElement() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");
    return overlaySink.rootPortalElement;
}

/**
 * Is our portal overlay element available yet in context for mounting elements?
 */
export function useIsOverlayPortalElementReady() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");
    return !!overlaySink.portalElement;
}
