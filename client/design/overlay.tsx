import {Instance, Rect, State, createPopper} from "@popperjs/core";
import {
    ReactElement,
    ReactNode,
    Ref,
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
import {createPortal, flushSync} from "react-dom";
import {Box} from "~/client/design/box.js";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup.js";
import {
    OverlaySinkContext,
    overlaySinkContextForTest,
    overlayVisiblePoppers,
    renderOverlayPortal,
} from "~/client/design/internal/overlay_sink_context.js";
import {
    getElementSafeAreaInsetTopPx,
    getElementWindowSafeAreaInsetBottomPx,
} from "~/client/design/safe_area_inset.js";
import {subscribeToMobileKeyboardFrameChange} from "~/client/design/subscribe_to_mobile_keyboard_frame_change.js";
import {useGetCurrentCoveredHeight} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {disableScrollInteractions} from "~/client/helpers/disable_scroll_interactions.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/helpers/use_resize_observer.js";
import {useStableJsonValue} from "~/client/helpers/use_stable_json_value.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {
    ParsableRemLength,
    RemLength,
    Spacing,
    convertRemLengthToPx,
} from "~/shared/design/core/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

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
    offset?: ParsableRemLength;

    /**
     * How far the offset should move along the reference.
     *
     * See the [demo][1] here.
     *
     * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
     */
    offsetAlong?: ParsableRemLength;

    /**
     * If true, the overlay tries to stay visible within the nearest parent
     * `<OverlayScopeContextProvider>`.
     *
     * Defaults to `true`.
     */
    preventOverflow?: boolean;

    /**
     * Space at the top of the screen we consider to be "overflow" area. That is
     * if an overlay is placed in this area the overlay will flip to a fallback
     * placement to avoid rendering in the area.
     *
     * Useful if you want your overlay to avoid the navigation bar's area.
     *
     * Top safe area is added to this value.
     */
    overflowTop?: Spacing | RemLength;

    /**
     * Space at the bottom of the screen we consider to be "overflow" area. That is
     * if an overlay is placed in this area the overlay will flip to a fallback
     * placement to avoid rendering in the area.
     *
     * Useful if on mobile your overlay is open when the software keyboard is open.
     * You can set some overflow bottom to ensure the overlay won't render in
     * keyboard space even when the keyboard is closed. So when the keyboard opens
     * the overlay won't jump around.
     *
     * Bottom safe area is added to this value but NOT bottom bar height.
     *
     * By default, this will use the mobile keyboard's height if the keyboard is
     * open. That default isn't enough if you're opening an overlay at the same
     * time the keyboard is opening. Since your overlay may open before the
     * keyboard animation causing your overlay to jump around.
     */
    overflowBottom?: Spacing | RemLength;

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
     * The string `"ContextMenu"` is a special blocking level above everything
     * else. Since the context menu needs to render on top of absolutely
     * everything, even when there's another blocking modal.
     *
     * Defaults to `false`.
     */
    isBlocking?: boolean | "ContextMenu";

    /**
     * When `isBlocking` is true if you don't want to render in the root overlay
     * boundary and instead render in the current overlay scope you may set this to
     * true.
     *
     * Useful if you have a scroll animation and you want your overlay to
     * animate smoothly with the scroll. Or if you want to contain your blocking
     * overlay to some element instead of allowing it to break out of the element.
     *
     * We'll still render a cover across the entire DOM to prevent interaction with
     * other elements but the cover will cut out the overlay's area so you can
     * interact with the overlay.
     *
     * Defaults to `false`.
     */
    withoutRootBlockingScope?: boolean;

    /**
     * When `isBlocking` is true should the target element still be interactive?
     * That way you can interact with the target element, the overlay element, but
     * nothing else because of the blocking cover.
     *
     * Useful for comboboxes where you want clicking outside the combobox to close
     * the overlay (but not trigger hover states or the click target of whatever's
     * underneath) but the user should still be able to select text within the
     * combobox.
     *
     * Defaults to `false`.
     */
    withoutBlockingTarget?: boolean;

    /**
     * Called when there's a `pointerdown` event on our blocking cover. Will only
     * be called if `isBlocking` is true.
     */
    onBlockingCoverPointerDown?: () => void;

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
        fallbackPlacements: unstableFallbackPlacements,
        overlay: actualOverlay,
        offset,
        offsetAlong,
        preventOverflow = true,
        overflowTop,
        overflowBottom,
        sameWidth = false,
        sameHeight = false,
        isBlocking = false,
        withoutRootBlockingScope = false,
        withoutBlockingTarget = false,
        onBlockingCoverPointerDown,
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

    const fallbackPlacements = useStableJsonValue(unstableFallbackPlacements ?? null);

    const overlayRef = useRef<HTMLDivElement>(null);
    const popperRef = useRef<(Instance & {maybeStartAnimationLoop(): void}) | null>(null);
    const blockingCoverRef = useRef<OverlayBlockingCoverRef>(null);

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

    const getPortalElement =
        isBlocking !== false && !withoutRootBlockingScope
            ? isBlocking === "ContextMenu"
                ? overlaySink.getContextMenuBlockingPortalElement
                : overlaySink.getBlockingPortalElement
            : overlaySink.getPortalElement;

    const getBlockingCoverPortalElement =
        isBlocking !== false
            ? isBlocking === "ContextMenu"
                ? overlaySink.getContextMenuBlockingPortalElement
                : overlaySink.getBlockingPortalElement
            : null;

    const [elementState, setElementState] = useState<{
        portalElement: HTMLDivElement | null;
        blockingCoverPortalElement: HTMLDivElement | null;
    }>(() => ({
        portalElement: getPortalElement(),
        blockingCoverPortalElement: getBlockingCoverPortalElement?.() ?? null,
    }));

    let {portalElement, blockingCoverPortalElement} = elementState;

    // If we are making the overlay visible and we initially read the portal ref as
    // `null` but not the portal ref has a value, update our state without waiting
    // for an effect.
    if (
        isVisible &&
        (portalElement === null ||
            (blockingCoverPortalElement === null && getBlockingCoverPortalElement !== null))
    ) {
        const currentPortalElement = getPortalElement();
        const currentBlockingCoverPortalElement = getBlockingCoverPortalElement?.() ?? null;

        if (currentPortalElement !== null || currentBlockingCoverPortalElement !== null) {
            if (currentPortalElement !== null) portalElement = currentPortalElement;
            if (currentBlockingCoverPortalElement !== null)
                blockingCoverPortalElement = currentBlockingCoverPortalElement;

            setElementState({portalElement, blockingCoverPortalElement});
        }
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

        setElementState({
            portalElement: getPortalElement(),
            blockingCoverPortalElement: getBlockingCoverPortalElement?.() ?? null,
        });
    }, [getBlockingCoverPortalElement, getPortalElement, isVisible]);

    const getCurrentCoveredHeight = useGetCurrentCoveredHeight();

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of an `<Overlay>` component to render an element with a ref to an HTML element",
            );

            if (!isVisible || !portalElement) return;

            let isDestroyed = false;

            assert(
                overlayRef.current && overlayRef.current instanceof HTMLElement,
                "Expected the overlay prop of an `<Overlay>` component to render an element with a ref to an HTML element",
            );
            const overlayElement = overlayRef.current;
            const blockingCover =
                isBlocking !== false ? assertExists(blockingCoverRef.current) : null;

            const getOptions = () => {
                // Getting the value of 1rem without subscribing so that all our `<Overlay>`
                // components don't need to re-render after the initial render.
                const spacingScale = getSpacingScaleWithoutListening();

                const paddingPx = convertRemLengthToPx("1", spacingScale);

                const portalRect = portalElement!.getBoundingClientRect();
                const viewportHeight = document.documentElement.getBoundingClientRect().height;

                const padding = {
                    top: sameHeight
                        ? 0
                        : paddingPx +
                          Math.max(
                              0,
                              getElementSafeAreaInsetTopPx(targetElement) -
                                  Math.max(0, portalRect.top),
                          ) +
                          (overflowTop !== undefined
                              ? convertRemLengthToPx(overflowTop, spacingScale)
                              : 0),
                    bottom: sameHeight
                        ? 0
                        : paddingPx +
                          (overflowBottom === undefined
                              ? Math.max(
                                    0,
                                    getCurrentCoveredHeight() -
                                        Math.max(0, viewportHeight - portalRect.bottom),
                                )
                              : Math.max(
                                    0,
                                    getElementWindowSafeAreaInsetBottomPx(targetElement) -
                                        Math.max(0, viewportHeight - portalRect.bottom),
                                ) + convertRemLengthToPx(overflowBottom, spacingScale)),
                    left: sameWidth
                        ? 0
                        : paddingPx +
                          (typeof overlaySink.insetLeft === "string"
                              ? convertRemLengthToPx(overlaySink.insetLeft, spacingScale)
                              : overlaySink.insetLeft ?? 0),
                    right: sameWidth
                        ? 0
                        : paddingPx +
                          (typeof overlaySink.insetRight === "string"
                              ? convertRemLengthToPx(overlaySink.insetRight, spacingScale)
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
                                              ? convertRemLengthToPx(offsetAlong, spacingScale)
                                              : 0,
                                          offset ? convertRemLengthToPx(offset, spacingScale) : 0,
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
                        {
                            name: "updateBlockingCoverRead",
                            enabled:
                                isBlocking !== false &&
                                (withoutRootBlockingScope || withoutBlockingTarget),
                            phase: "main" as const,
                            requires: ["hide"],
                            fn: ({state}: {state: State}) => {
                                const offsetParentRect =
                                    state.elements.popper.offsetParent?.getBoundingClientRect();

                                state.modifiersData.updateBlockingCoverRead = {
                                    popperRelativeCoord: {
                                        x: offsetParentRect?.x ?? 0,
                                        y: offsetParentRect?.y ?? 0,
                                    },
                                };
                            },
                        },
                        {
                            name: "updateBlockingCoverWrite",
                            enabled:
                                isBlocking !== false &&
                                (withoutRootBlockingScope || withoutBlockingTarget),
                            phase: "write" as const,
                            fn: ({state}: {state: State}) => {
                                const popperRelativeCoord: {x: number; y: number} | undefined =
                                    state.modifiersData.updateBlockingCoverRead
                                        ?.popperRelativeCoord;

                                const rects = {
                                    target: {
                                        width: state.rects.reference.width,
                                        height: state.rects.reference.height,
                                        x: state.rects.reference.x + (popperRelativeCoord?.x ?? 0),
                                        y: state.rects.reference.y + (popperRelativeCoord?.y ?? 0),
                                    },
                                    overlay: {
                                        width: state.rects.popper.width,
                                        height: state.rects.popper.height,
                                        x:
                                            (state.modifiersData.popperOffsets?.x ?? 0) +
                                            (popperRelativeCoord?.x ?? 0),
                                        y:
                                            (state.modifiersData.popperOffsets?.y ?? 0) +
                                            (popperRelativeCoord?.y ?? 0),
                                    },
                                };

                                if (isCreatingPopper) {
                                    assertExists(blockingCover).setRects(rects);
                                } else {
                                    flushSync(() => {
                                        assertExists(blockingCover).setRects(rects);
                                    });
                                }
                            },
                            // If `isBlocking` is true and `withoutRootBlockingScope` is true then we need
                            // to make sure scrolling in the overlay element won't end up scrolling the
                            // overlay's scrollable parent. We do this by attaching event listeners that'll
                            // call `event.preventDefault()` when the user tries to scroll.
                            //
                            // Try removing this then scrolling a blocking overlay which can't scroll (e.g.
                            // the task priority input). Scrolling on the priority input will scroll the
                            // view whereas scrolling on the blocking cover will do nothing.
                            effect: ({state}: {state: State}) => {
                                if (!withoutRootBlockingScope) return;

                                const scrollParent =
                                    state.scrollParents.popper[0] instanceof HTMLElement
                                        ? state.scrollParents.popper[0]
                                        : null;
                                if (!scrollParent) return;

                                return disableScrollInteractions(
                                    scrollParent,
                                    (event, targetScrollableParent) =>
                                        targetScrollableParent !== null &&
                                        overlayRef.current !== null &&
                                        overlayRef.current.contains(targetScrollableParent.element),
                                );
                            },
                        },
                    ],
                };
            };

            let isCreatingPopper = true;
            try {
                let isAnimationLoopRunning = false;

                // This function checks to see if `targetElement` or any of its parents has a
                // running animation. If there is a running animation then we setup a
                // `requestAnimationFrame()` loop to update our popper position every animation
                // frame. We call this once when the lifecycle ref initializes and check after
                // our current set of animations finishes (in case a new set of animations
                // started afterwards).
                //
                // Test case for this:
                //
                // 1. Go into a task collection
                // 2. Copy a bullet list from a document (optionally with indentation)
                // 3. Paste the bullet list
                // 4. Undo the paste (cmd-z)
                // 5. Redo the paste (cmd-shift-z)
                // 6. Undo the paste (cmd-z)
                //
                // At step 6 the task title should be focused and it should be animating up.
                // Since we run task movement animations on undo/redo. We need to update the
                // position of the `<FocusRing>` (which renders an `<Overlay>`) in this
                // animation loop.
                const maybeStartAnimationLoop = () => {
                    if (isDestroyed) return;
                    if (isAnimationLoopRunning) return;

                    const animationFinishedPromises: Array<Promise<unknown>> = [];

                    let targetParentElement: HTMLElement | null = targetElement;
                    while (targetParentElement !== null) {
                        for (const animation of targetParentElement.getAnimations()) {
                            animationFinishedPromises.push(animation.finished);
                        }
                        targetParentElement = targetParentElement.parentElement;
                    }

                    if (animationFinishedPromises.length === 0) return;

                    isAnimationLoopRunning = true;

                    const runAnimationLoop = () => {
                        requestAnimationFrame(() => {
                            if (isDestroyed) return;

                            popper.forceUpdate();

                            // When `isAnimationLoopRunning` is `false` we want to run
                            // `popper.forceUpdate()` once last time before finishing the loop.
                            //
                            // Once our animation loop finishes running (since the previous set of
                            // animations has finished) then try to start the animation loop again if
                            // there's a new set of animations on our target element.
                            if (isAnimationLoopRunning) {
                                runAnimationLoop();
                            } else {
                                maybeStartAnimationLoop();
                            }
                        });
                    };

                    runAnimationLoop();

                    void Promise.allSettled(animationFinishedPromises).finally(() => {
                        isAnimationLoopRunning = false;
                    });
                };

                // The Popper library was deprecated and replaced with Floating UI.
                // Functionality-wise, Popper is still working great for us. The Popper
                // documentation lives on here:
                // https://popper.js.org/docs/v2/
                const popper = Object.assign(
                    createPopper(targetElement, overlayElement, getOptions()),
                    {maybeStartAnimationLoop},
                );

                popperRef.current = popper;
                overlayVisiblePoppers.add(popper);

                // Make sure Popper is positioned correctly. We find that sometimes after
                // parameter updates (e.g. `placement` changes), Popper won't have the
                // right position.
                popper.forceUpdate();

                // Update the overlay placement if the target or overlay element resizes.
                const handleResize = () => popper.forceUpdate();
                addResizeListenerForElement(targetElement, handleResize);
                addResizeListenerForElement(overlayElement, handleResize);

                // If we're using `sameWidth` or `sameHeight` then calling
                // `popper.forceUpdate()` after a resize will cause the overlay element to
                // resize. It's ok if resize listeners don't fire on the overlay element after
                // this.
                if (
                    sameWidth ||
                    sameHeight ||
                    (isBlocking !== false && (withoutRootBlockingScope || withoutBlockingTarget))
                ) {
                    addSuppressResizeLoopErrorNotificationForElement(targetElement);
                    addSuppressResizeLoopErrorNotificationForElement(overlayElement);
                }

                maybeStartAnimationLoop();

                const originalTargetElementId = targetElement.id;
                const originalOverlayElementId = overlayElement.id;

                const cleanupTargetElementAttributes = setElementAttributesWithCleanup(
                    targetElement,
                    {
                        id: !originalTargetElementId ? defaultTargetElementId : undefined,

                        "aria-owns": originalOverlayElementId
                            ? originalOverlayElementId
                            : `${defaultTargetElementId}-overlay`,
                    },
                );

                const cleanupOverlayElementAttributes = setElementAttributesWithCleanup(
                    overlayElement,
                    {
                        id: !originalOverlayElementId
                            ? `${defaultTargetElementId}-overlay`
                            : undefined,

                        "data-ownedby": originalTargetElementId
                            ? originalTargetElementId
                            : defaultTargetElementId,
                    },
                );

                const cleanupBlockingCoverElementAttributes = blockingCover
                    ? setElementAttributesWithCleanup(blockingCover.getElement(), {
                          "data-ownedby": originalOverlayElementId
                              ? originalOverlayElementId
                              : `${defaultTargetElementId}-overlay`,
                      })
                    : null;

                // If the mobile keyboard frame changes while our overlay is visible then
                // update the overlay's options with the new covered height (read in
                // `getOptions()`).
                const unsubscribeFromMobileKeyboardFrameChange =
                    subscribeToMobileKeyboardFrameChange(() => {
                        void popper.setOptions(getOptions());
                    });

                return () => {
                    isDestroyed = true;
                    overlayVisiblePoppers.delete(popper);
                    popperRef.current = null;
                    popper.destroy();
                    removeResizeListenerForElement(targetElement, handleResize);
                    removeResizeListenerForElement(overlayElement, handleResize);
                    if (
                        sameWidth ||
                        sameHeight ||
                        (isBlocking !== false &&
                            (withoutRootBlockingScope || withoutBlockingTarget))
                    ) {
                        removeSuppressResizeLoopErrorNotificationForElement(targetElement);
                    }
                    isAnimationLoopRunning = false;
                    cleanupTargetElementAttributes();
                    cleanupOverlayElementAttributes();
                    cleanupBlockingCoverElementAttributes?.();
                    unsubscribeFromMobileKeyboardFrameChange();
                };
            } finally {
                isCreatingPopper = false;
            }
        },
        [
            isVisible,
            portalElement,
            isBlocking,
            sameHeight,
            overflowTop,
            overflowBottom,
            getCurrentCoveredHeight,
            sameWidth,
            overlaySink.insetLeft,
            overlaySink.insetRight,
            placement,
            preventOverflow,
            fallbackPlacements,
            offsetAlong,
            offset,
            withoutRootBlockingScope,
            withoutBlockingTarget,
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

            // Try starting the animation loop as well in case any animations were started
            // in a layout effect.
            popperRef.current?.maybeStartAnimationLoop();
        });
    });

    useEffect(() => {
        if (!isVisible) return;

        // Run in a microtask so that parent effects run before we update the
        // popper position.
        scheduleMicrotask(() => {
            // Try starting the animation loop as well in case any animations were started
            // in an effect.
            popperRef.current?.maybeStartAnimationLoop();
        });
    });

    return (
        <>
            {isVisible &&
                portalElement &&
                // This intentionally comes before `children` so that React executes
                // `overlayRef` before `targetRef`.
                createPortal(
                    isBlocking === false ? (
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
                isBlocking !== false &&
                blockingCoverPortalElement &&
                // When we have a blocking overlay add a cover to the document to prevent
                // scrolling, hover effects, and any other interaction while the context menu
                // is open.
                createPortal(
                    <OverlayBlockingCover
                        ref={blockingCoverRef}
                        shouldExcludeTarget={withoutBlockingTarget}
                        shouldExcludeOverlay={withoutRootBlockingScope}
                        onPointerDown={onBlockingCoverPointerDown}
                    />,
                    blockingCoverPortalElement,
                )}
            {useElementWithRef(children, useLifecycleRef(targetLifecycleRef))}
        </>
    );
}

function BlockingOverlayScopeContextProvider({children}: {children: ReactNode}) {
    const parentOverlaySink = assertExists(
        useContext(OverlaySinkContext) ?? overlaySinkContextForTest,
    );

    const blockingPortalRef = useRef<HTMLDivElement>(null);

    return (
        <OverlaySinkContext.Provider
            value={useMemo(
                () => ({
                    getRootPortalElement: parentOverlaySink.getBlockingPortalElement,
                    // If you render another blocking overlay inside of a blocking overlay then the
                    // first blocking overlay must be covered. To do this we create a new portal
                    // location for new blocking overlays that will render on top of old blocking
                    // overlays.
                    getBlockingPortalElement: () => blockingPortalRef.current,
                    getContextMenuBlockingPortalElement:
                        parentOverlaySink.getContextMenuBlockingPortalElement,
                    getPortalElement: parentOverlaySink.getBlockingPortalElement,
                    insetLeft: null,
                    insetRight: null,
                }),
                [parentOverlaySink],
            )}
        >
            {children}
            {renderOverlayPortal(
                // eslint-disable-next-line react-compiler/react-compiler
                blockingPortalRef,
                "70",
            )}
        </OverlaySinkContext.Provider>
    );
}

type OverlayBlockingCoverRef = {
    getElement(): HTMLDivElement;
    setRects(rects: {target: Rect; overlay: Rect}): void;
};

const shouldDebugOverlayBlockingCover: CommitBlocker | null = null;

// Only allow `shouldDebugOverlayBlockingCover` to be true in development.
if (process.env.NODE_ENV !== "development") {
    assert(!shouldDebugOverlayBlockingCover);
}

const OverlayBlockingCover = forwardRef(function OverlayBlockingCover(
    {
        shouldExcludeTarget,
        shouldExcludeOverlay,
        onPointerDown,
    }: {
        shouldExcludeTarget: boolean;
        shouldExcludeOverlay: boolean;
        onPointerDown: (() => void) | undefined;
    },
    ref: Ref<OverlayBlockingCoverRef>,
) {
    const elementRef = useRef<HTMLDivElement>(null);

    const [rectFromState, setRects] = useState<{target: Rect; overlay: Rect} | null>(null);
    let rects = rectFromState;
    if (rectFromState && !shouldExcludeTarget && !shouldExcludeOverlay) {
        rects = null;
        setRects(null);
    }

    const coverRects = useMemo(() => {
        if (!rects) return null;

        let coverRects = [new Rectangle(0, 0, Infinity, Infinity)];

        if (shouldExcludeTarget) {
            coverRects = coverRects.flatMap(coverRect =>
                coverRect.difference(Rectangle.from(rects!.target)),
            );
        }

        if (shouldExcludeOverlay) {
            coverRects = coverRects.flatMap(coverRect =>
                coverRect.difference(Rectangle.from(rects!.overlay)),
            );
        }

        return coverRects;
    }, [rects, shouldExcludeOverlay, shouldExcludeTarget]);

    useImperativeHandle(
        ref,
        () => ({
            getElement: () => assertExists(elementRef.current),
            setRects: newRects => {
                const {target: newTargetRect, overlay: newOverlayRect} = newRects;

                setRects(oldRects => {
                    if (!oldRects) return newRects;

                    const {target: oldTargetRect, overlay: oldOverlayRect} = oldRects;

                    if (
                        oldTargetRect.width === newTargetRect.width &&
                        oldTargetRect.height === newTargetRect.height &&
                        oldTargetRect.x === newTargetRect.x &&
                        oldTargetRect.y === newTargetRect.y &&
                        oldOverlayRect.width === newOverlayRect.width &&
                        oldOverlayRect.height === newOverlayRect.height &&
                        oldOverlayRect.x === newOverlayRect.x &&
                        oldOverlayRect.y === newOverlayRect.y
                    ) {
                        return oldRects;
                    }

                    return newRects;
                });
            },
        }),
        [],
    );

    if (!coverRects) {
        return (
            <Box
                ref={elementRef}
                position="absolute"
                top="0"
                left="0"
                zIndex="-10"
                style={{width: "100vw", height: "100vh"}}
                onPointerDown={event => {
                    // Prevent the browser from moving focus when pressing on the overlay blocking
                    // cover.
                    //
                    // This is important for `context_menu.tsx`. You right click in a focused
                    // element which opens our custom context menu. If you click the blocking cover
                    // to close the custom context menu we don't want the element you had previously
                    // focused to lose focus.
                    //
                    // To reproduce a bug which happens when we don't have `event.preventDefault()`
                    // here: Go to `<ContentEditor>`. Select to highlight some text. Right click the
                    // text. The pointer toolbar should go away and the right click menu should be
                    // visible. Click the blocking cover to close the context menu. If the
                    // `<ContentEditor>` maintained focus the entire time then the pointer toolbar
                    // should reappear.
                    event.preventDefault();

                    onPointerDown?.();
                }}
            />
        );
    } else {
        return (
            <Box
                ref={elementRef}
                pointerEvents="none"
                position="absolute"
                top="0"
                left="0"
                zIndex="-10"
                style={{width: "100vw", height: "100vh"}}
                onPointerDown={event => {
                    // Prevent the browser from moving focus when pressing on the overlay blocking
                    // cover.
                    //
                    // This is important for `context_menu.tsx`. You right click in a focused
                    // element which opens our custom context menu. If you click the blocking cover
                    // to close the custom context menu we don't want the element you had previously
                    // focused to lose focus.
                    //
                    // To reproduce a bug which happens when we don't have `event.preventDefault()`
                    // here: Go to `<ContentEditor>`. Select to highlight some text. Right click the
                    // text. The pointer toolbar should go away and the right click menu should be
                    // visible. Click the blocking cover to close the context menu. If the
                    // `<ContentEditor>` maintained focus the entire time then the pointer toolbar
                    // should reappear.
                    event.preventDefault();

                    onPointerDown?.();
                }}
            >
                {coverRects.map((coverRect, i) => (
                    <Box
                        key={i}
                        pointerEvents="auto"
                        position="absolute"
                        opacity={shouldDebugOverlayBlockingCover ? "50" : undefined}
                        backgroundColor={shouldDebugOverlayBlockingCover ? "red-10" : undefined}
                        style={{
                            top: isFinite(coverRect.top) ? `${coverRect.top}px` : "100vh",
                            bottom: isFinite(coverRect.bottom)
                                ? `calc(100vh - ${coverRect.bottom}px)`
                                : "0",
                            left: isFinite(coverRect.left) ? `${coverRect.left}px` : "100vw",
                            right: isFinite(coverRect.right)
                                ? `calc(100vw - ${coverRect.right}px)`
                                : "0",
                        }}
                    />
                ))}
            </Box>
        );
    }
});
