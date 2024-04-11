import {Instance, Rect, State, createPopper} from "@popperjs/core";
import {
    ReactElement,
    ReactNode,
    Ref,
    RefObject,
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
import {Box} from "~/client/design/box.js";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {subscribeToMobileKeyboardFrameChange} from "~/client/design/subscribe_to_mobile_keyboard_frame_change.js";
import {getCurrentCoveredHeight} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {useStableJsonValue} from "~/client/helpers/use_stable_json_value.js";
import {
    RemLength,
    Spacing,
    convertRemLengthToPx,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Sprinkles, sprinkles} from "~/shared/styles/styles.js";

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
    offset?: Spacing | `-${Spacing}` | RemLength;

    /**
     * How far the offset should move along the reference.
     *
     * See the [demo][1] here.
     *
     * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
     */
    offsetAlong?: Spacing | `-${Spacing}` | RemLength;

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
     * Does this overlay block interaction with everything else on the page? If
     * true then we render in the root overlay boundary and render a cover
     * across the entire DOM.
     *
     * Defaults to `false`.
     */
    isBlocking?: boolean;

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
        isVisible = false,
        placement,
        fallbackPlacements: _fallbackPlacements,
        overlay: actualOverlay,
        offset,
        offsetAlong,
        preventOverflow = true,
        sameWidth = false,
        sameHeight = false,
        isBlocking = false,
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

    const portalRef = isBlocking ? overlaySink.rootBlockingPortalRef : overlaySink.portalRef;

    const [_portalElement, setPortalElement] = useState(portalRef.current);
    let portalElement = _portalElement;

    // If we are making the overlay visible and we initially read the portal ref as
    // `null` but not the portal ref has a value, update our state without waiting
    // for an effect.
    if (isVisible && portalElement === null && portalRef.current !== null) {
        portalElement = portalRef.current;
        setPortalElement(portalRef.current);
    }

    // If this component is rendered at the same time as our
    // `<OverlayScopeContextProvider>` then we will get `null` when reading
    // `portalRef.current` in render. So re-render with the actual element. We
    // will only re-render if the overlay is visible on initial mount.
    //
    // This may cause the overlay portal to flash in. Consider a layout
    // effect here to prevent flashes.
    useEffect(() => {
        if (!isVisible) return;
        setPortalElement(portalRef.current);
    }, [isVisible, portalRef]);

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of an `<Overlay>` component to render an element with a ref to an HTML element",
            );

            if (!isVisible || !portalElement) return;

            assert(
                overlayRef.current && overlayRef.current instanceof HTMLElement,
                "Expected the overlay prop of an `<Overlay>` component to render an element with a ref to an HTML element",
            );
            const overlayElement = overlayRef.current;

            const getOptions = () => {
                // Getting the value of 1rem without subscribing so that all our `<Overlay>`
                // components don't need to re-render after the initial render.
                const remPx = getRemPxWithoutListening();

                const paddingPx = convertRemLengthToPx(spacing["1"], remPx);

                const padding = {
                    top: sameHeight ? 0 : paddingPx + getElementSafeAreaInsetTopPx(targetElement),
                    bottom: sameHeight ? 0 : paddingPx + getCurrentCoveredHeight(),
                    left: sameWidth
                        ? 0
                        : paddingPx +
                          (typeof overlaySink.insetLeft === "string"
                              ? parseRemLengthNumber(overlaySink.insetLeft) * remPx
                              : overlaySink.insetLeft ?? 0),
                    right: sameWidth
                        ? 0
                        : paddingPx +
                          (typeof overlaySink.insetRight === "string"
                              ? parseRemLengthNumber(overlaySink.insetRight) * remPx
                              : overlaySink.insetRight ?? 0),
                };

                return {
                    placement: placement === "center" ? "top-start" : placement,
                    modifiers: [
                        {
                            name: "preventOverflow",
                            enabled: preventOverflow,
                            options: {padding},
                        },
                        {
                            name: "flip",
                            enabled: placement !== "center",
                            options: {
                                fallbackPlacements,
                                padding,
                            },
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
                                                        !offsetAlong.endsWith("rem")
                                                            ? spacing[
                                                                  offsetAlong.slice(1) as Spacing
                                                              ]
                                                            : (offsetAlong.slice(1) as RemLength),
                                                        remPx,
                                                    )
                                                  : convertRemLengthToPx(
                                                        !offsetAlong.endsWith("rem")
                                                            ? spacing[offsetAlong as Spacing]
                                                            : (offsetAlong as RemLength),
                                                        remPx,
                                                    )
                                              : 0,
                                          offset
                                              ? offset.startsWith("-")
                                                  ? -convertRemLengthToPx(
                                                        !offset.endsWith("rem")
                                                            ? spacing[offset.slice(1) as Spacing]
                                                            : (offset.slice(1) as RemLength),
                                                        remPx,
                                                    )
                                                  : convertRemLengthToPx(
                                                        !offset.endsWith("rem")
                                                            ? spacing[offset as Spacing]
                                                            : (offset as RemLength),
                                                        remPx,
                                                    )
                                              : 0,
                                      ],
                                  },
                              },
                        {
                            name: "sameWidth",
                            enabled: sameWidth,
                            phase: "beforeWrite" as const,
                            requires: ["computeStyles"],
                            fn: ({state}: {state: State}) => {
                                state.styles.popper!.width = `${state.rects.reference.width}px`;
                            },
                            effect: ({state}: {state: State}) => {
                                state.elements.popper.style.width = `${
                                    (state.elements.reference as HTMLElement).offsetWidth
                                }px`;
                            },
                        },
                        {
                            name: "sameHeight",
                            enabled: sameHeight,
                            phase: "beforeWrite" as const,
                            requires: ["computeStyles"],
                            fn: ({state}: {state: State}) => {
                                state.styles.popper!.height = `${state.rects.reference.height}px`;
                            },
                            effect: ({state}: {state: State}) => {
                                state.elements.popper.style.height = `${
                                    (state.elements.reference as HTMLElement).offsetHeight
                                }px`;
                            },
                        },
                    ],
                };
            };

            // The Popper library was deprecated and replaced with Floating UI.
            // Functionality-wise, Popper is still working great for us. The Popper
            // documentation lives on here:
            // https://popper.js.org/docs/v2/
            const popper = createPopper(targetElement, overlayElement, getOptions());

            popperRef.current = popper;

            // Make sure Popper is positioned correctly. We find that sometimes after
            // parameter updates (e.g. `placement` changes), Popper won't have the
            // right position.
            popper.forceUpdate();

            // Update the overlay placement if the target element resizes.
            const handleResize = () => popper.forceUpdate();
            addResizeListenerForElement(targetElement, handleResize);

            const originalTargetElementId = targetElement.id;
            const originalOverlayElementId = overlayElement.id;

            const cleanupTargetElementAttributes = setElementAttributesWithCleanup(targetElement, {
                id: !originalTargetElementId ? defaultTargetElementId : undefined,

                "aria-owns": originalOverlayElementId
                    ? originalOverlayElementId
                    : `${defaultTargetElementId}-overlay`,
            });

            const cleanupOverlayElementAttributes = setElementAttributesWithCleanup(
                overlayElement,
                {
                    id: !originalOverlayElementId ? `${defaultTargetElementId}-overlay` : undefined,

                    "data-ownedby": originalTargetElementId
                        ? originalTargetElementId
                        : defaultTargetElementId,

                    // It's important the overlay is focusable for `<FocusScope contain>`. That way
                    // when you click into the overlay, focus goes to this element instead of
                    // `document.body`. If `<FocusScope contain>` sees focus on `document.body` then
                    // it will move focus right back to the element that was blurred which is not
                    // what the user wants.
                    //
                    // If `tabindex` is already set we don't want to override it.
                    tabindex: overlayElement.getAttribute("tabindex") ?? "-1",
                },
            );

            // If the mobile keyboard frame changes while our overlay is visible then
            // update the overlay's options with the new covered height (read in
            // `getOptions()`).
            const unsubscribeFromMobileKeyboardFrameChange = subscribeToMobileKeyboardFrameChange(
                () => {
                    void popper.setOptions(getOptions());
                },
            );

            return () => {
                popperRef.current = null;
                popper.destroy();
                removeResizeListenerForElement(targetElement, handleResize);
                cleanupTargetElementAttributes();
                cleanupOverlayElementAttributes();
                unsubscribeFromMobileKeyboardFrameChange();
            };
        },
        [
            isVisible,
            portalElement,
            overlaySink.insetLeft,
            overlaySink.insetRight,
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
            {isVisible &&
                portalElement &&
                // This intentionally comes before `children` so that React executes
                // `overlayRef` before `targetRef`.
                createPortal(
                    !isBlocking ? (
                        overlay
                    ) : (
                        // If a blocking overlay itself renders overlays then those need to go in the
                        // blocking overlay portal element.
                        <BlockingOverlayScopeContextProvider>
                            {overlay}
                        </BlockingOverlayScopeContextProvider>
                    ),
                    portalElement,
                )}
            {isVisible &&
                isBlocking &&
                portalElement &&
                // When we have a blocking overlay add a cover to the document to prevent
                // scrolling, hover effects, and any other interaction while the context menu
                // is open. Renders at z-index 60 to be below the blocking overlay container.
                createPortal(
                    <Box position="absolute" inset="0" zIndex="60" />,
                    assertExists(portalElement.parentElement),
                )}
            {useElementWithRef(children, useLifecycleRef(targetLifecycleRef))}
        </>
    );
}

const OverlaySinkContext = createContext<{
    rootPortalRef: RefObject<HTMLDivElement>;
    rootBlockingPortalRef: RefObject<HTMLDivElement>;
    portalRef: RefObject<HTMLDivElement>;
    insetLeft: RemLength | number | null;
    insetRight: RemLength | number | null;
} | null>(null);

/**
 * Child `<Overlay>` components will be rendered inside this component.
 *
 * Generally you want to render one of these inside every scrollable element.
 * That way the overlays naturally scroll with the element and can't render
 * outside the element.
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
    const parentOverlaySink = useContext(OverlaySinkContext);
    const portalRef = useRef<HTMLDivElement>(null);
    const blockingPortalRef = useRef<HTMLDivElement>(null);

    return (
        <OverlaySinkContext.Provider
            value={useMemo(
                () => ({
                    rootPortalRef: parentOverlaySink?.rootPortalRef ?? portalRef,
                    rootBlockingPortalRef:
                        parentOverlaySink?.rootBlockingPortalRef ?? blockingPortalRef,
                    portalRef,
                    insetLeft: insetLeft ?? null,
                    insetRight: insetRight ?? null,
                }),
                [insetLeft, insetRight, parentOverlaySink],
            )}
        >
            {children}
            {renderOverlayPortal(portalRef)}
            {!parentOverlaySink &&
                renderOverlayPortal(
                    blockingPortalRef,
                    // Render at the absolute top of the page. Even over other overlays.
                    "70",
                )}
        </OverlaySinkContext.Provider>
    );
}

export function renderOverlayPortal(
    ref: RefObject<HTMLDivElement>,
    zIndex: Sprinkles["zIndex"] = "50",
) {
    return (
        <Box
            ref={ref}
            position="absolute"
            top="0"
            left="0"
            right="0"
            // The overlay portal element has a height of 0 because when you use it in a
            // nested scroll view we don't want the overlay height to extend from the top
            // to the bottom of the nested scroll view which is not the scroll view's
            // content height.
            height="0"
            // Render above anything on the page.
            zIndex={zIndex}
        />
    );
}

function BlockingOverlayScopeContextProvider({children}: {children: ReactNode}) {
    const parentOverlaySink = assertExists(useContext(OverlaySinkContext));

    return (
        <OverlaySinkContext.Provider
            value={useMemo(
                () => ({
                    rootPortalRef: parentOverlaySink.rootBlockingPortalRef,
                    rootBlockingPortalRef: parentOverlaySink.rootBlockingPortalRef,
                    portalRef: parentOverlaySink.rootBlockingPortalRef,
                    insetLeft: null,
                    insetRight: null,
                }),
                [parentOverlaySink],
            )}
        >
            {children}
        </OverlaySinkContext.Provider>
    );
}

// In Jest tests, create a portal element in the JSDOM `<body>`.
const overlaySinkContextForTest = import.meta.jest
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

          const blockingPortalElement = document.createElement("div");

          blockingPortalElement.className = sprinkles({
              position: "absolute",
              top: "0",
              left: "0",
              right: "0",
              // The root portal element has a height of 0 because when you use it in a
              // nested scroll view we don't want the overlay height to extend from the top
              // to the bottom of the nested scroll view.
              height: "0",
              // Render above anything on the page.
              zIndex: "70",
          });

          document.body.appendChild(portalElement);
          document.body.appendChild(blockingPortalElement);

          const portalRef = {current: portalElement};
          const blockingPortalRef = {current: blockingPortalElement};

          return {
              rootPortalRef: portalRef,
              rootBlockingPortalRef: blockingPortalRef,
              portalRef,
              insetLeft: null,
              insetRight: null,
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

    const [rootPortalElement, setRootPortalElement] = useState(overlaySink.rootPortalRef.current);

    useEffect(() => {
        setRootPortalElement(overlaySink.rootPortalRef.current);
    }, [overlaySink.rootPortalRef]);

    return rootPortalElement;
}

/**
 * Get the _blocking_ overlay portal element at the root of our app. We may
 * have nested portal overlay elements in, for instance, scroll views so
 * overlays move with the scroll view and can't escape.
 */
export function useOverlayRootBlockingPortalElement() {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [rootBlockingPortalElement, setRootBlockingPortalElement] = useState(
        overlaySink.rootBlockingPortalRef.current,
    );

    useEffect(() => {
        setRootBlockingPortalElement(overlaySink.rootBlockingPortalRef.current);
    }, [overlaySink.rootBlockingPortalRef]);

    return rootBlockingPortalElement;
}

/**
 * If you have an `<Overlay>` element with a ref on the `overlay` prop then you
 * will not be able to access the ref until the overlay portal is ready. You
 * may use this hook for detecting this edge case.
 *
 * If your overlay's initial render is the same as the nearest
 * `<OverlayScopeContextProvider>`'s initial render and your overlay is
 * initially visible then this will start as `true` then return `false`.
 * Otherwise this always returns `false`.
 */
export function useIsWaitingForOverlayPortalElement(isVisible: boolean): boolean {
    const overlaySink = useContext(OverlaySinkContext) ?? overlaySinkContextForTest;
    assert(overlaySink, "Expected a parent `<OverlayScopeContextProvider>` component");

    const [isWaiting, setIsWaiting] = useState(isVisible ? !overlaySink.portalRef.current : false);

    useEffect(() => {
        setIsWaiting(isVisible ? !overlaySink.portalRef.current : false);
    }, [isVisible, overlaySink.portalRef]);

    return isWaiting;
}
