import {Memo, RefCallback, useCallback} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {getElementSafeAreaInsetTopPx} from "~/client/web/design/safe_area_inset.js";
import {ElementEventEmitter} from "~/client/web/helpers/element_event_emitter.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {getRemPxWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {scrollbarStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ParsableRemLength, parseRemLength} from "~/shared/design/core/spacing.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

const {
    nativeScrollbarClassName,
    scrollbarThumbClassName,
    scrollbarThumbDraggingClassName,
    scrollbarThumbFadeOutAnimationDurationMs,
    scrollbarThumbHitClassName,
    scrollbarThumbHitFadeOutClassName,
    scrollbarThumbHitHideClassName,
    scrollbarThumbHoveredClassName,
} = scrollbarStyles;

const scrollbarThumbMargin = "0.5";
const scrollbarThumbInteractiveMargin = "1.5";
const scrollbarThumbWidth = "1.5";
const minScrollbarThumbHeight = "6";

const scrollbarThumbMarginRem = parseRemLength(scrollbarThumbMargin);
const scrollbarThumbInteractiveMarginRem = parseRemLength(scrollbarThumbInteractiveMargin);
const scrollbarThumbWidthRem = parseRemLength(scrollbarThumbWidth);
const minScrollbarThumbHeightRem = parseRemLength(minScrollbarThumbHeight);

const scrollbarThumbHitWidthRem =
    scrollbarThumbInteractiveMarginRem + scrollbarThumbWidthRem + scrollbarThumbMarginRem;

export type ScrollbarInset = ParsableRemLength | number;

export type ScrollbarInsetDynamic =
    | ScrollbarInset
    | Memo<readonly [ScrollbarInset, {readonly withSafeArea?: boolean}]>;

export const safeAreaOnlyScrollbarInsetTop: ScrollbarInsetDynamic = markMemoIfNotRendering([
    0,
    {withSafeArea: true},
]);

export function convertScrollbarInsetToPx(inset: ScrollbarInset, remPx: number) {
    return typeof inset === "string" ? parseRemLength(inset) * remPx : inset;
}

export function convertScrollbarInsetDynamicToPx(
    inset: ScrollbarInsetDynamic,
    remPx: number,
    element: HTMLElement,
) {
    const insetNumber = typeof inset === "object" ? inset[0] : inset;
    const insetOptions = typeof inset === "object" ? inset[1] : undefined;

    return (
        convertScrollbarInsetToPx(insetNumber, remPx) +
        (insetOptions?.withSafeArea ? getElementSafeAreaInsetTopPx(element) : 0)
    );
}

/**
 * Duration after scrolling before the scrollbar disappears. We also use this to
 * determine when our navigation bar should animate to fully hidden or fully
 * revealed. We want our navigation bar to perform this animation at the same time
 * the scrollbar disappears.
 *
 * Since on mobile iOS platforms we use the native scrollbar, ideally this timeout
 * would be the same as the timeout until which iOS scrollbars disappear. That way
 * the navigation bar disappears with native scrollbars. We can't quite perfectly
 * replicate the time iOS native scrollbars disappear since while the user is
 * touching the screen on iOS, the scrollbar will remain.
 *
 * From some primitive testing, 1.2s appears to be the duration Apple uses for iOS.
 */
export const scrollbarVisibleAfterScrollDurationMs = 1200;

export function useScrollbar<T extends HTMLElement>({
    inset,
    insetY,
    insetTop,
    insetBottom,
    insetRight,
    getScrollHeight,
}: {
    inset?: ScrollbarInset;
    insetY?: ScrollbarInset;
    insetTop?: ScrollbarInsetDynamic;
    insetBottom?: ScrollbarInset;
    insetRight?: ScrollbarInset;
    getScrollHeight?: Memo<() => number>;
} = {}): RefCallback<T> {
    insetTop = insetTop ?? insetY ?? inset;
    insetBottom = insetBottom ?? insetY ?? inset;
    insetRight = insetRight ?? inset;

    return useLifecycleRef(
        useCallback(
            element =>
                initializeScrollbar(element, {
                    insetTop,
                    insetBottom,
                    insetRight,
                    getScrollHeight,
                }),
            [getScrollHeight, insetBottom, insetRight, insetTop],
        ),
    );
}

/**
 * Values of `navigator.platform` for mobile iOS devices. Excludes iPad.
 *
 * See: https://stackoverflow.com/a/9039885/1568890
 */
const appleIosMobilePlatforms = new Set(["iPhone Simulator", "iPod Simulator", "iPhone", "iPod"]);

/**
 * Instead of using native platform scrollbars, we implement our own custom
 * scrollbars in JavaScript. By default, scrollable elements do not have a
 * scrollbar and you must call `initializeScrollbar()` (or the more convenient
 * `useScrollbar()`) to give the element a scrollbar.
 *
 * ## Why custom scrollbars?
 *
 * We use custom scrollbars to ensure design consistency across all platforms. The
 * ideal scrollbar design for our product:
 *
 * 1. Is overlain on top of our content
 * 2. Disappears when the user is not scrolling
 *
 * The scrollbar is more of an indicator of position then an actual tactile
 * control. This is a modern scrollbar design (inspired by mobile). Opposed to
 * chunky old fashioned scrollbars which take horizontal space from the content and
 * have up/down arrow buttons.
 *
 * That MacOS default scrollbar has these two properties. However, the Windows
 * default scrollbar does not. It's a chunky scrollbar that takes horizontal space.
 * On MacOS you can also configure scrollbars to always be displayed using a chunky
 * non-overlain design.
 *
 * This makes scrollbars a little challenging to design around. Your screen needs
 * to work well with any platform scrollbar style. There are some [CSS
 * customization options][1] for scrollbars but they're quite limited and different
 * browsers support different properties. The CSS customization options currently
 * do not support overlain scrollbars.
 *
 * In addition to cross platform design consistency, we get very powerful design
 * customization opportunities. For example, we support adding additional inset for
 * the scrollbar. This is great in our `<MessageInput>` component where the
 * scrollbar is in a container with some aggressive `border-radius`. This is also
 * useful for some views in our task product where after you scroll for a bit you
 * get a sticky header (e.g. the personal task view where you scroll past the
 * active task section). In a view like that we don't want the scrollbar to cover
 * the sticky header. That breaks the sticky header physical material analogy.
 *
 * We use a lot of virtual scroll views for data heavy screens. Scrollbars and
 * virtualized views are tricky since content is being loaded/resized while you
 * scroll. In the future we should explore ways to make the scrollbar feel more
 * fluid while lazy loading data so it doesn't jump around. For now we emulate the
 * same behavior as a native scrollbar.
 *
 * ## Mobile iOS (excluding iPad)
 *
 * Apple's iOS operating system has pretty great scrollbars. They meet our two
 * requirements for a scrollbar (iOS scrollbars are overlain on content and
 * disappear when the user is not scrolling).
 *
 * iOS scrollbars also have a bunch of useful iOS-specific behaviors:
 *
 * - Shrinks when overscrolling
 * - Tapping, dragging, then throwing the scrollbar does a momentum scroll
 * - Gets bigger on press and provides haptic feedback
 *
 * So to meet platform expectations, we use the native scrollbars on mobile iOS. We
 * accept that our enhancements (like configurable insets) aren't available and
 * design around that.
 *
 * iPad still uses our custom scrollbars since it uses the desktop UI. So custom
 * behaviors like configurable insets are more important.
 *
 * ## How do we implement our custom scrollbar?
 *
 * We could use a library like [OverlayScrollbars][2] but instead we implement our
 * scrollbars from scratch. This is because I couldn't find a library that does NOT
 * use the `scroll` event to implement the scrollbar.
 *
 * The problem with using the `scroll` event to implement a scroll-linked effect is
 * in modern browsers scrolling happens asynchronously in a separate thread so the
 * user doesn't see lag. Any UI that updates itself by listening to the `scroll`
 * event will end up looking janky or jittery since it's out-of-sync with the
 * scroll rendering thread. Firefox has [good documentation on the scroll-linked
 * effects problem][3] with some solutions. One common solution is to use
 * `position: sticky` to build UI like sticky headers.
 *
 * Another solution is to make the `scroll` event synchronous! [Monday.com has done
 * this in their grid view UI][4]. The way this approach works is you listen for
 * the `wheel` event, call `event.preventDefault()`, then manually update the
 * element's `scrollTop`. While this works, it makes it harder to achieve butter
 * smooth 60fps scrolling since the browser has to wait for JavaScript code to
 * execute in between each scroll frame.
 *
 * So we want to use a solution like `position: sticky` to get buttery smooth
 * scrolling animations.
 *
 * ### Time for some math
 *
 * `position: sticky` is designed for UI like sticky headers that move at the same
 * rate as the user scrolls. However, our custom scrollbar needs to move slower
 * than the rate at which the user scrolls so it stays in frame for the entire
 * content view. We can change the rate at which the scrollbar moves with
 * `transform: scaleY()`.
 *
 * Let's visualize this. We render a scrollbar track the entire scroll view content
 * height. We can render a scrollbar thumb as our scroll view window's height and
 * give it `position: sticky` so that it moves with the scroll view window.
 *
 * ```
 *                                         scrollbar
 *                                           track
 *                                             ↓
 *              ┌► ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┯━┓
 *              │  ┃                          │ ┃
 *  scroll view │  ┃                          │ ┃
 *    content   │  ┃                          │ ┃
 *              │  ┠──────────────────────────┼─┨ ◄┐
 *              │  ┃          scroll          │ ┃  │
 *              │  ┃           view           │ ┃  │ scrollbar
 *              │  ┃          window          │ ┃  │   thumb
 *              │  ┠──────────────────────────┼─┨ ◄┘
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              └► ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┷━┛
 * ```
 *
 * Now we have a scrollbar, we can scale it down with
 * `transform: scaleY(scrollViewWindowHeight / scrollViewContentHeight)`. The
 * problem is while the scaled scrollbar is the right size and moves at the right
 * speed, it's stuck at the top of the view! The scaled scrollbar needs to move
 * with the scroll window.
 *
 * So what we do is instead of scaling the scrollbar track down, we scale the
 * scrollbar track up! And with math make sure the thumb moves through the track at
 * the correct speed. Like this:
 *
 * ```
 *                                         scrollbar
 *                                           track
 *                                             ↓
 *              ┌► ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┯━┓
 *              │  ┃                          │ ┃
 *  scroll view │  ┃                          │ ┃
 *    content   │  ┃                          │ ┃
 *              │  ┠──────────────────────────┼─┨
 *              │  ┃          scroll          ├─┨ ◄┐
 *              │  ┃           view           │ ┃  │
 *              │  ┃          window          │ ┃  │ scrollbar
 *              │  ┠──────────────────────────┼─┨  │   thumb
 *              │  ┃                          │ ┃  │
 *              │  ┃                          │ ┃  │
 *              │  ┃                          ├─┨ ◄┘
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              └► ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┿━┩
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            └─┘
 * ```
 *
 * Here we've scaled our scrollbar track up by ~50%. The scrollbar thumb is also
 * now about ~50% larger than the scroll view window and has moved further down the
 * track. It's now in the correct position but it's not the correct size. If we
 * apply `transform: scaleY()` again on just our thumb we can get it to be the
 * correct size in the correct position.
 *
 * ```
 *                                         scrollbar
 *                                           track
 *                                             ↓
 *              ┌► ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┯━┓
 *              │  ┃                          │ ┃
 *  scroll view │  ┃                          │ ┃
 *    content   │  ┃                          │ ┃
 *              │  ┠──────────────────────────┼─┨
 *              │  ┃          scroll          ├─┨ ◄┐ scrollbar
 *              │  ┃           view           ├─┨ ◄┘   thumb
 *              │  ┃          window          │ ┃
 *              │  ┠──────────────────────────┼─┨
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              │  ┃                          │ ┃
 *              └► ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┿━┩
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            │ │
 *                                            └─┘
 * ```
 *
 * So how do we figure out what our scrollbar track scale factor should be? Let's
 * say the variable `scale` is how much the track needs to scale.
 *
 * The thumb will move from `y = 0` to
 * `y = (contentHeight - windowHeight) * scale`. Let's write down an equation for
 * the `maxThumbY` variable.
 *
 * ```
 * maxThumbY = (contentHeight - windowHeight) * scale
 * ```
 *
 * Our thumb height starts as `windowHeight` then scaled it has a height of
 * `windowHeight * scale`. At the end we scale the thumb back to our desired height
 * which is:
 *
 * ```
 * thumbDesiredHeight = windowHeight * (windowHeight / contentHeight)
 * ```
 *
 * Well, we also apply a minimum size so its doesn't get too small in a large
 * scroll view:
 *
 * ```
 * thumbDesiredHeight = max(windowHeight * (windowHeight / contentHeight), minThumbDesiredHeight)
 * ```
 *
 * Visually to the user the thumb moves from `y = 0` to
 * `y = contentHeight - thumbDesiredHeight`. This value should be the same as
 * `maxThumbY`.
 *
 * ```
 * maxThumbY = contentHeight - thumbDesiredHeight
 * ```
 *
 * We have a system of equations here!
 *
 * ```
 * maxThumbY = (contentHeight - windowHeight) * scale
 * maxThumbY = contentHeight - thumbDesiredHeight
 * ```
 *
 * or:
 *
 * ```
 * (contentHeight - windowHeight) * scale = contentHeight - thumbDesiredHeight
 * ```
 *
 * If we solve for `scale` we get:
 *
 * ```
 * scale = (contentHeight - thumbDesiredHeight) / (contentHeight - windowHeight)
 * ```
 *
 * The insight here is the scaled up thumb should end at the same Y position as
 * after we scale it back down.
 *
 * To my (@calebmer's) knowledge this approach hasn't been used before for building
 * a custom scrollbar. However, since inventing this approach [I've found another
 * approach from the Chrome developer blog that uses `transform: matrix3d()` to
 * achieve the same effect][5]. The [CSS Houdini low-level APIs][6] should
 * eventually make it possible to implement this scrollbar effect without
 * workarounds like this.
 *
 * On 2024-01-26 I (@calebmer) tried converting our scrollbar implementation to use
 * `transform: matrix3d()` as described by the Chrome developer blog but it [had
 * issues on Safari where the `z-index` didn't take effect and instead Safari used
 * 3d z-order][7]. I couldn't find a way to make it work.
 *
 * [1]: https://css-tricks.com/the-current-state-of-styling-scrollbars-in-css/
 * [2]: https://kingsora.github.io/OverlayScrollbars/
 * [3]:
 *     https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html
 * [4]:
 *     https://engineering.monday.com/our-journey-to-understand-scrolling-across-different-browsers/
 * [5]: https://developer.chrome.com/blog/custom-scrollbar/
 * [6]: https://developer.mozilla.org/en-US/docs/Web/Guide/Houdini
 * [7]:
 *     https://stackoverflow.com/questions/22621544/webkit-transform-breaks-z-index-on-safari
 */
export function initializeScrollbar(
    element: HTMLElement,
    {
        insetTop = 0,
        insetBottom = 0,
        insetRight = 0,
        getScrollHeight,
    }: {
        insetTop?: ScrollbarInsetDynamic;
        insetBottom?: ScrollbarInset;
        insetRight?: ScrollbarInset;
        getScrollHeight?: () => number;
    },
): () => void {
    {
        const {position} = getComputedStyle(element);

        // Scrollbar will lay itself out with `position: absolute` so the scrollable
        // element should form a containing block. The easiest way to do this is by setting
        // `position: relative` on the scrollable element but here are some other ways:
        // https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block
        if (process.env.NODE_ENV !== "development") {
            assert(
                position === "relative",
                "Scrollable element must be a containing block (set `position: relative` on the element)",
            );
        } else if (position !== "relative") {
            // In development, when hot reloading `<Root>` after a state change (like adding an
            // effect) the style `<link>` will be re-rendered which temporarily causes
            // `getComputedStyle(element).position` to report the wrong value. So wait a
            // macrotask and check again.
            scheduleMacrotask(() => {
                const {position} = getComputedStyle(element);

                assert(
                    position === "relative",
                    "Scrollable element must be a containing block (set `position: relative` on the element)",
                );
            });
        }
    }

    let visibleAfterScrollTimeout: Timeout | null = null;

    /* ========================================================================== *\
     *                                    iOS                                     *
    \* ========================================================================== */

    if (appleIosMobilePlatforms.has(navigator.platform)) {
        element.classList.add(nativeScrollbarClassName);
        elementsWithInitializedScrollbarForDev?.add(element);

        return () => {
            elementsWithInitializedScrollbarForDev?.delete(element);
            element.classList.remove(nativeScrollbarClassName);
        };
    }

    /* ========================================================================== *\
     *                               Construct DOM                                *
    \* ========================================================================== */

    const scrollbarElement = document.createElement("div");

    const scrollbarTrackElement = document.createElement("div");
    scrollbarElement.appendChild(scrollbarTrackElement);

    const scrollbarThumbStickyElement = document.createElement("div");
    scrollbarTrackElement.appendChild(scrollbarThumbStickyElement);

    const scrollbarThumbHitElement = document.createElement("div");
    scrollbarThumbStickyElement.appendChild(scrollbarThumbHitElement);

    const scrollbarThumbElement = document.createElement("div");
    scrollbarThumbHitElement.appendChild(scrollbarThumbElement);

    /* ========================================================================== *\
     *                              Constant styling                              *
    \* ========================================================================== */

    scrollbarElement.className = sprinkles({
        position: "absolute",
        top: "0",
        right: "0",
        pointerEvents: "none",
    });

    // Above `z-index: 0` but below `z-index: 10`. `z-index: 10` is the first `z-index`
    // you can set with `sprinkles()`.
    scrollbarElement.style.zIndex = "5";

    scrollbarElement.style.width =
        insetRight !== 0
            ? typeof insetRight === "number"
                ? `calc(${scrollbarThumbHitWidthRem}rem + ${insetRight}px)`
                : `${scrollbarThumbHitWidthRem + parseRemLength(insetRight)}rem`
            : `${scrollbarThumbHitWidthRem}rem`;

    // For our scrollbar implementation, we scale up the scrollbar track so the
    // scrollbar thumb moves faster down the track than the user's scroll. So then we
    // need to hide the excess scrollbar track.
    //
    // We can't use `overflow: hidden` since that creates a new scrolling ancestor that
    // `sticky` will stick to instead of our parent scroll view. So we use
    // `contain: paint` instead which has the same effect but doesn't create a new
    // scrolling ancestor.
    scrollbarElement.style.contain = "paint";

    scrollbarTrackElement.className = sprinkles({
        position: "absolute",
        inset: "0",
    });

    scrollbarTrackElement.style.transformOrigin = "top center";

    scrollbarThumbStickyElement.className = sprinkles({
        position: "sticky",
        top: "0",
        left: "0",
        right: "0",
    });

    scrollbarThumbHitElement.className = scrollbarThumbHitClassName;

    scrollbarThumbHitElement.style.paddingLeft = `${scrollbarThumbInteractiveMarginRem}rem`;

    scrollbarThumbHitElement.style.paddingRight =
        insetRight !== 0
            ? typeof insetRight === "number"
                ? `calc(${scrollbarThumbMarginRem}rem + ${insetRight}px)`
                : `${scrollbarThumbMarginRem + parseRemLength(insetRight)}rem`
            : `${scrollbarThumbMarginRem}rem`;

    scrollbarThumbElement.className = scrollbarThumbClassName;

    /* ========================================================================== *\
     *                        Handle resizing & scrolling                         *
    \* ========================================================================== */

    let sizes: {
        scrollHeight: number;
        clientHeight: number;
    } | null = null;

    const handleResize = () => {
        const clientHeight = element.clientHeight;

        // We can't use `element.scrollHeight` to get the scrollable element's content
        // height. That's because it includes the height of our scrollbar. If the
        // scrollable element's content shrinks then our scrollbar will maintain the old
        // height. So calculate `element.scrollHeight` excluding the scrollbar.
        let scrollHeight = 0;

        const elementComputedStyle = getComputedStyle(element);

        // The caller may pass in their own `getScrollHeight()` implementation to bypass
        // our calculation. This is useful for `<VirtualizedScrollView>` which carefully
        // computes its own scroll height. Sometimes we've observed the computation below
        // is off by 1px (probably due to subpixel rendering) so it's useful to use
        // `<VirtualizedScrollView>`'s calculation.
        if (getScrollHeight !== undefined) {
            scrollHeight = getScrollHeight();
        } else {
            const elementRect = element.getBoundingClientRect();

            for (const childNode of element.childNodes) {
                if (!(childNode instanceof HTMLElement)) continue;

                // Ignore our scrollbar element.
                if (childNode === scrollbarElement) continue;

                const childNodeRect = childNode.getBoundingClientRect();

                // The offset from the top of our child to the top of our scroll area `element`. We
                // use `getBoundingClientRect()` for subpixel accuracy.
                //
                // TODO(calebmer): `getBoundingClientRect()` returns values with CSS transforms
                // applied. Which we don't want for our position calculations here. We need some
                // code here to detect if CSS transforms are applied and invert them.
                const childOffsetTop = childNodeRect.top - elementRect.top + element.scrollTop;
                const childHeight = childNodeRect.height;

                // Children can be positioned in many surprising ways between `display: flex` or
                // `float: right` or `position: absolute`. To determine the height of our content,
                // we look for the element with the largest bottom position.
                scrollHeight = Math.max(scrollHeight, childOffsetTop + childHeight);
            }
        }

        // Make sure the element's `paddingTop`/`paddingBottom` is included in the computed
        // height.
        //
        // NOTE(calebmer): I'm not sure if this is the correct calculation when we have
        // some absolute positioned elements affecting the element's height?
        let paddingTopPx: number;
        let paddingBottomPx: number;
        {
            paddingTopPx = parseFloat(elementComputedStyle.paddingTop);
            if (isNaN(paddingTopPx)) paddingTopPx = 0;

            paddingBottomPx = parseFloat(elementComputedStyle.paddingBottom);
            if (isNaN(paddingBottomPx)) paddingBottomPx = 0;

            // If a custom scroll height function was provided then we've already fully
            // computed the scroll height for this element.
            if (getScrollHeight !== undefined) {
                scrollHeight = Math.max(scrollHeight, paddingTopPx);
                scrollHeight += paddingBottomPx;
            }
        }

        // Optimization: If `scrollHeight` and `clientHeight` don't change then don't
        // update our styles which may cause the browser to do some layout work.
        if (
            sizes !== null &&
            sizes.scrollHeight === scrollHeight &&
            sizes.clientHeight === clientHeight
        ) {
            return;
        }

        // If after a resize we have less scroll content then the scrollable element,
        // cancel any scrolling animations and hide the scrollbar.
        if (
            sizes !== null &&
            scrollHeight <= clientHeight &&
            sizes.scrollHeight > sizes.clientHeight
        ) {
            scrollbarThumbHitElement.classList.add(scrollbarThumbHitHideClassName);
            scrollbarThumbHitElement.classList.remove(scrollbarThumbHitFadeOutClassName);

            visibleAfterScrollTimeout?.clear();
            visibleAfterScrollTimeout = null;

            cancelDrag();
        }

        if (sizes === null) {
            sizes = {scrollHeight, clientHeight};
        } else {
            sizes.scrollHeight = scrollHeight;
            sizes.clientHeight = clientHeight;
        }

        const remPx = getRemPxWithoutListening();

        const insetTopPx = convertScrollbarInsetDynamicToPx(insetTop, remPx, element);
        const insetBottomPx = convertScrollbarInsetToPx(insetBottom, remPx);
        const insetRightPx = convertScrollbarInsetToPx(insetRight, remPx);

        const thumbHeight = Math.max(
            clientHeight * ((clientHeight - insetTopPx - insetBottomPx) / scrollHeight),
            minScrollbarThumbHeightRem * remPx,
        );

        const thumbStickyHeight = insetTopPx + thumbHeight + insetBottomPx;

        const trackScaleY =
            scrollHeight > clientHeight
                ? (thumbStickyHeight - scrollHeight) / (clientHeight - scrollHeight)
                : // If there is not enough content to fill the scroll view we'll hide the scrollbar
                  // so don't scale beyond 2. (Otherwise the scale grows exponentially.)
                  2;
        const undoTrackScaleY = 1 / trackScaleY;

        scrollbarElement.style.height = `${scrollHeight}px`;
        scrollbarThumbStickyElement.style.height = `${thumbStickyHeight * undoTrackScaleY}px`;

        scrollbarTrackElement.style.transform = `scaleY(${trackScaleY})`;

        // We want `thumbMarginRem` vertical padding on our thumb. But since our thumb is
        // scaled we need to scale the padding to achieve this effect.
        scrollbarThumbStickyElement.style.paddingTop =
            scrollbarThumbStickyElement.style.paddingBottom = `${
                scrollbarThumbMarginRem * undoTrackScaleY
            }rem`;

        if (insetTopPx !== 0) {
            scrollbarThumbStickyElement.style.paddingTop = `${
                (insetTopPx + scrollbarThumbMarginRem * remPx) * undoTrackScaleY
            }px`;
        }

        if (insetBottom !== 0) {
            scrollbarThumbStickyElement.style.paddingBottom = `${
                (insetBottomPx + scrollbarThumbMarginRem * remPx) * undoTrackScaleY
            }px`;
        }

        // NOTE(calebmer): It would appear that in elements with padding, `top: 0` on a
        // sticky element starts the element inside the parent's padding? Counter-act this
        // by applying negative padding.
        //
        // This feels hacky, though. Don't love this solution.
        if (paddingTopPx > 0) {
            scrollbarThumbStickyElement.style.top = `-${paddingTopPx}px`;
        }

        const borderRadius = (scrollbarThumbWidthRem * remPx) / 2;
        const borderRadiusWithUndoTrackScaleY = borderRadius * undoTrackScaleY;

        // We want a fully rounded `border-radius` on our thumb. But since our thumb is
        // scaled we need to scale the vertical rounding to achieve this effect.
        scrollbarThumbElement.style.borderRadius = `${borderRadius}px / ${borderRadiusWithUndoTrackScaleY}px`;

        // These two styles affect overscroll bounds in Safari. A sticky element moves with
        // overscroll in Safari. However, a sticky element can't:
        //
        // 1. Move further up then its initial position
        // 2. Move further down then the bottom of the content area of its parent
        //
        // We want to allow our scrollbar to move out of our scrollable content (and so
        // shrink as it slides out of bounds) but only until it reaches certain bounds.
        // That way the scrollbar will never completely shrink to nothing.
        //
        // For 1 we use negative margin to set the sticky element's initial position out of
        // the scroll track. For 2 we add padding to the bottom of the scroll track so
        // eventually the scrollbar stops moving down the track.
        //
        // We need negative margin for the scrollbar to be able to move out of bounds at
        // all. Otherwise it stops its movement at the top of scrollable content which is
        // its natural initial position.
        //
        // To test try scrolling on an iOS device or with trackpad or magic mouse on Safari
        // for MacOS. Then overscroll near the top/bottom of the container.
        {
            const extraTrackHeight = scrollHeight * trackScaleY - scrollHeight;
            const overscrollThumbHeight = thumbHeight - minScrollbarThumbHeightRem * remPx;

            scrollbarThumbStickyElement.style.marginTop = `-${
                overscrollThumbHeight * undoTrackScaleY
            }px`;

            scrollbarTrackElement.style.paddingBottom = `${
                (extraTrackHeight - overscrollThumbHeight) * undoTrackScaleY
            }px`;
        }

        // Add a `clip-path` to our scrollbar element to handle Safari overscrolling. When
        // the user is overscrolling the scrollbar leaves the bounds of of the scrollbar
        // element and so is clipped. To make sure it's not clipped with a hard edge, we
        // add a `clip-path` to give the scrollbar a rounded edge when clipped. This has
        // the effect of making the scrollbar look like it's shrinking when overscrolled.
        //
        // To test this try overscrolling on iOS and see how the scrollbar appears to
        // shrink.
        //
        // To debug the clip path add `backgroundColor: "red-10"` or similar to
        // `scrollbarElement`.
        {
            const scrollbarWidthPx = scrollbarThumbHitWidthRem * remPx + insetRightPx;
            const scrollbarThumbMarginPx = scrollbarThumbMarginRem * remPx;
            const scrollbarThumbInteractiveMarginRemPx = scrollbarThumbInteractiveMarginRem * remPx;

            /* eslint-disable cyberworlds/string-quotes */

            // We're drawing the following shape except the knobs at the top/bottom are rounded
            // instead of square..
            //
            // ```
            //   ┌─┐
            // ┌─┘ └─┐
            // │     │
            // │     │
            // └─┐ ┌─┘
            //   └─┘
            // ```
            //
            // At each step we'll trace where our path currently is by adding double lines.
            scrollbarElement.style.clipPath = `path("${[
                // ```
                //   ┌─┐
                // ╒─┘ └─┐
                // │     │
                // │     │
                // └─┐ ┌─┘
                //   └─┘
                // ```
                `M 0,${scrollbarThumbMarginPx + borderRadius}`,

                // ```
                //   ┌─┐
                // ╒═╛ └─┐
                // │     │
                // │     │
                // └─┐ ┌─┘
                //   └─┘
                // ```
                `L ${scrollbarThumbInteractiveMarginRemPx},${
                    scrollbarThumbMarginPx + borderRadius
                }`,

                // ```
                //   ╔═╗
                // ╒═╝ ╙─┐
                // │     │
                // │     │
                // └─┐ ┌─┘
                //   └─┘
                // ```
                `A ${borderRadius},${borderRadius} 0 0 1 ${
                    scrollbarWidthPx - scrollbarThumbMarginPx - insetRightPx
                },${scrollbarThumbMarginPx + borderRadius}`,

                // ```
                //   ╔═╗
                // ╒═╝ ╚═╕
                // │     │
                // │     │
                // └─┐ ┌─┘
                //   └─┘
                // ```
                `L ${scrollbarWidthPx},${scrollbarThumbMarginPx + borderRadius}`,

                // ```
                //   ╔═╗
                // ╒═╝ ╚═╗
                // │     ║
                // │     ║
                // └─┐ ┌─╜
                //   └─┘
                // ```
                `L ${scrollbarWidthPx},${scrollHeight - scrollbarThumbMarginPx - borderRadius}`,

                // ```
                //   ╔═╗
                // ╒═╝ ╚═╗
                // │     ║
                // │     ║
                // └─┐ ╒═╝
                //   └─┘
                // ```
                `L ${scrollbarWidthPx - scrollbarThumbMarginPx - insetRightPx},${
                    scrollHeight - scrollbarThumbMarginPx - borderRadius
                }`,

                // ```
                //   ╔═╗
                // ╒═╝ ╚═╗
                // │     ║
                // │     ║
                // └─╖ ╔═╝
                //   ╚═╝
                // ```
                `A ${borderRadius},${borderRadius} 0 0 1 ${scrollbarThumbInteractiveMarginRemPx},${
                    scrollHeight - scrollbarThumbMarginPx - borderRadius
                }`,

                // ```
                //   ╔═╗
                // ╒═╝ ╚═╗
                // │     ║
                // │     ║
                // ╘═╗ ╔═╝
                //   ╚═╝
                // ```
                `L 0,${scrollHeight - scrollbarThumbMarginPx - borderRadius}`,

                // ```
                //   ╔═╗
                // ╔═╝ ╚═╗
                // ║     ║
                // ║     ║
                // ╚═╗ ╔═╝
                //   ╚═╝
                // ```
                "Z",
            ].join(" ")}")`;

            /* eslint-enable cyberworlds/string-quotes */
        }
    };

    // Temporarily show the scrollbar while the user is scrolling then fade it out
    // after a timeout.
    const handleScroll = () => {
        // If the pointer is over our scrollbar then it doesn't disappear until the pointer
        // leaves the scrollbar.
        if (isPointerOver) return;

        // Don't hide the scrollbar while we're dragging it.
        if (dragState) return;

        restartVisibleAfterScrollTimeout();
    };

    const restartVisibleAfterScrollTimeout = () => {
        if (sizes === null || sizes.scrollHeight <= sizes.clientHeight) return;

        scrollbarThumbHitElement.classList.remove(scrollbarThumbHitHideClassName);
        scrollbarThumbHitElement.classList.remove(scrollbarThumbHitFadeOutClassName);

        visibleAfterScrollTimeout?.clear();
        visibleAfterScrollTimeout = null;

        let timeout2: Timeout | null = null;

        const timeout1 = createTimeout(() => {
            scrollbarThumbHitElement.classList.add(scrollbarThumbHitFadeOutClassName);

            timeout2 = createTimeout(() => {
                scrollbarThumbHitElement.classList.add(scrollbarThumbHitHideClassName);
                scrollbarThumbHitElement.classList.remove(scrollbarThumbHitFadeOutClassName);
            }, scrollbarThumbFadeOutAnimationDurationMs);
        }, scrollbarVisibleAfterScrollDurationMs);

        visibleAfterScrollTimeout = {
            clear: () => {
                visibleAfterScrollTimeout = null;
                timeout1.clear();
                timeout2?.clear();
            },
        };
    };

    // The scrollbar always starts out hidden.
    scrollbarThumbHitElement.classList.add(scrollbarThumbHitHideClassName);

    // Run resize function to initialize styles.
    handleResize();

    /* ========================================================================== *\
     *                           Handle drag to scroll                            *
    \* ========================================================================== */

    // We don't need to `removeEventListener()` for pointer event listeners on
    // `scrollbarThumbHitElement` since `scrollbarThumbHitElement` is detached from the
    // DOM when the scrollbar is destroyed.

    let isPointerOver = false;

    let dragState: {
        coverElement: HTMLDivElement;
        startPointerY: number;
        startClientHeight: number;
        startScrollHeight: number;
        startScrollTop: number;
    } | null = null;

    const startDrag = (event: PointerEvent) => {
        if (dragState) return;

        if (sizes === null || sizes.scrollHeight <= sizes.clientHeight) return;

        // If we're in a menu and the user tries to drag the scrollbar, prevent default so
        // the menu doesn't close.
        //
        // Also useful for dragging to scroll a comment input floater which if you try
        // clicking out will ask if you want to discard the comment.
        event.preventDefault();

        const dragCoverElement = document.createElement("div");

        dragCoverElement.className = sprinkles({
            position: "absolute",
            inset: "0",
            zIndex: "70",
            cursor: "default",
        });

        dragState = {
            coverElement: dragCoverElement,
            startPointerY: event.y,
            startClientHeight: sizes.clientHeight,
            startScrollHeight: sizes.scrollHeight,
            startScrollTop: element.scrollTop,
        };

        scrollbarThumbHitElement.classList.remove(scrollbarThumbHitHideClassName);
        scrollbarThumbHitElement.classList.remove(scrollbarThumbHitFadeOutClassName);

        visibleAfterScrollTimeout?.clear();
        visibleAfterScrollTimeout = null;

        scrollbarThumbElement.classList.add(scrollbarThumbDraggingClassName);
        document.body.appendChild(dragCoverElement);
        document.addEventListener("pointerup", handleDocumentPointerUp);
        document.addEventListener("pointermove", handleDocumentPointerMove);
    };

    const cancelDrag = () => {
        if (!dragState) return;

        scrollbarThumbElement.classList.remove(scrollbarThumbDraggingClassName);
        document.body.removeChild(dragState.coverElement);
        document.removeEventListener("pointerup", handleDocumentPointerUp);
        document.removeEventListener("pointermove", handleDocumentPointerMove);

        dragState = null;

        // Hide the scrollbar after a delay when we're done dragging.
        restartVisibleAfterScrollTimeout();
    };

    scrollbarThumbHitElement.addEventListener("pointerdown", startDrag);

    scrollbarThumbHitElement.addEventListener("pointerenter", () => {
        isPointerOver = true;

        scrollbarThumbElement.classList.add(scrollbarThumbHoveredClassName);

        if (!dragState && sizes !== null && sizes.scrollHeight > sizes.clientHeight) {
            scrollbarThumbHitElement.classList.remove(scrollbarThumbHitHideClassName);
            scrollbarThumbHitElement.classList.remove(scrollbarThumbHitFadeOutClassName);

            visibleAfterScrollTimeout?.clear();
            visibleAfterScrollTimeout = null;
        }
    });

    scrollbarThumbHitElement.addEventListener("pointerleave", () => {
        isPointerOver = false;

        scrollbarThumbElement.classList.remove(scrollbarThumbHoveredClassName);

        if (!dragState) {
            // Hide the scrollbar after a delay when the pointer leaves.
            restartVisibleAfterScrollTimeout();
        }
    });

    const handleDocumentPointerUp = () => {
        cancelDrag();
    };

    const handleDocumentPointerMove = (event: PointerEvent) => {
        if (!dragState) return;

        const speed = dragState.startScrollHeight / dragState.startClientHeight;

        element.scrollTop = dragState.startScrollTop + (event.y - dragState.startPointerY) * speed;
    };

    /* ========================================================================== *\
     *                       Connect to scrollable element                        *
    \* ========================================================================== */

    element.appendChild(scrollbarElement);

    elementsWithInitializedScrollbarForDev?.add(element);

    // `handleResize` shouldn't cause resize observer issues so suppress error
    // notifications.
    addSuppressResizeLoopErrorNotificationForElement(element);
    addResizeListenerForElement(element, handleResize);
    const unsubscribeScrollbarResizeFlush = scrollbarResizeFlushEventEmitter.subscribe(
        element,
        handleResize,
    );
    element.addEventListener("scroll", handleScroll);

    const listeningToChildElementResizes = new Set<HTMLElement>();
    for (const childNode of element.childNodes) {
        if (!(childNode instanceof HTMLElement)) continue;

        // Ignore our scrollbar element.
        if (childNode === scrollbarElement) continue;

        // `handleResize` shouldn't cause resize observer issues so suppress error
        // notifications.
        addSuppressResizeLoopErrorNotificationForElement(childNode);
        addResizeListenerForElement(childNode, handleResize);
        listeningToChildElementResizes.add(childNode);
    }

    // We need to listen to:
    //
    // - `element.clientHeight` changes
    // - `element.scrollHeight` changes
    //
    // `element.clientHeight` changes are covered by listening to resizes on `element`.
    // To detect `element.scrollHeight` changes we need to listen to resizes on all
    // children elements. So setup a `MutationObserver` that tells us when children are
    // added/removed so we can listen to resizes for them.
    const mutationObserver = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === "childList") {
                if (record.addedNodes && record.addedNodes.length > 0) {
                    for (const addedNode of record.addedNodes) {
                        if (!(addedNode instanceof HTMLElement)) continue;

                        // Ignore our scrollbar element.
                        if (addedNode === scrollbarElement) continue;

                        // Adding a resize listener will make an initial call to `handleResize()`. We don't
                        // need to make an additional call.
                        addSuppressResizeLoopErrorNotificationForElement(addedNode);
                        addResizeListenerForElement(addedNode, handleResize);
                        listeningToChildElementResizes.add(addedNode);
                    }
                }

                if (record.removedNodes && record.removedNodes.length > 0) {
                    // Removed nodes may change `element.scrollHeight`.
                    handleResize();

                    for (const removedNode of record.removedNodes) {
                        if (!(removedNode instanceof HTMLElement)) continue;

                        // Ignore our scrollbar element.
                        if (removedNode === scrollbarElement) continue;

                        removeSuppressResizeLoopErrorNotificationForElement(removedNode);
                        removeResizeListenerForElement(removedNode, handleResize);
                        listeningToChildElementResizes.delete(removedNode);
                    }
                }
            }
        }
    });

    mutationObserver.observe(element, {
        childList: true,
    });

    return () => {
        visibleAfterScrollTimeout?.clear();
        visibleAfterScrollTimeout = null;

        /* ========================================================================== *\
         *                     Disconnect from scrollable element                     *
        \* ========================================================================== */

        mutationObserver.disconnect();

        for (const element of listeningToChildElementResizes) {
            removeSuppressResizeLoopErrorNotificationForElement(element);
            removeResizeListenerForElement(element, handleResize);
        }

        listeningToChildElementResizes.clear();

        removeSuppressResizeLoopErrorNotificationForElement(element);
        removeResizeListenerForElement(element, handleResize);
        unsubscribeScrollbarResizeFlush();
        element.removeEventListener("scroll", handleScroll);
        elementsWithInitializedScrollbarForDev?.delete(element);

        element.removeChild(scrollbarElement);
    };
}

const scrollbarResizeFlushEventEmitter = new ElementEventEmitter("scrollbarresizeflush");

/**
 * If we're about to synchronously observe `element.scrollHeight` on this or any
 * parent element possibly after the document was resized then we can't wait for
 * `MutationObserver` or `ResizeObserver` to handle scrollbar resizes. We need to
 * immediately resize scrollbars.
 *
 * This function will let you synchronously flush scrollbar resizes so you can
 * safely read `element.scrollHeight`.
 */
export function flushScrollbarResizeSync(element: Element) {
    let currentElement: Element | null = element;

    while (currentElement) {
        scrollbarResizeFlushEventEmitter.emit(currentElement);
        currentElement = currentElement.parentElement;
    }
}

let wasScrollbarAuditorInstalled = false;

const elementsWithInitializedScrollbarForDev: WeakSet<HTMLElement> | null =
    process.env.NODE_ENV !== "production" ? new WeakSet() : null;

/**
 * Audits the entire DOM tree and if we see a scrollable element mount without a
 * custom scrollbar we log a warning so the developer knows to fix it.
 *
 * Instead of using native browser scrollbars, we implement our own custom
 * scrollbars in JavaScript. This allows us to maintain design consistency across
 * all platforms we support. But each scrollbar needs some manual configuration by
 * the developer. This auditor makes sure we don't miss any scrollbars.
 */
export function installScrollbarAuditorInDev() {
    assert(process.env.NODE_ENV !== "production");
    assert(!wasScrollbarAuditorInstalled);
    wasScrollbarAuditorInstalled = true;

    let mutationRecordBatches: Array<Array<MutationRecord>> = [];

    const observer = new MutationObserver(records => {
        mutationRecordBatches.push(records);
        maybeScheduleAudit();
    });

    observer.observe(document, {
        subtree: true,
        childList: true,
        // We only check elements when they initially mount. Maybe we should recheck
        // elements after a `style` or `className` change?
        attributes: false,
    });

    let hasScheduledAudit = false;

    // Schedule an initial audit...
    maybeScheduleAudit();

    function maybeScheduleAudit() {
        if (!hasScheduledAudit) {
            hasScheduledAudit = true;

            // Throttle auditing to every 1s since we don't want auditing to impact main thread
            // interaction performance.
            setTimeout(() => {
                // Use the React scheduler to schedule an idle callback. `requestIdleCallback()` is
                // not implemented in Safari. Generally we recommend using the React scheduler
                // since it has centralized knowledge of all our tasks (including UI rendering).
                //
                // Since the `audit()` function could be expensive maybe we may want to check with
                // the `scheduler` if we should yield back to the main thread and resume later.
                unstable_scheduleCallback(unstable_IdlePriority, () => {
                    hasScheduledAudit = false;
                    audit();
                });
            }, 1000);
        }
    }

    let hasInitiallyCheckedDocumentBody = false;

    function audit() {
        if (!hasInitiallyCheckedDocumentBody) {
            hasInitiallyCheckedDocumentBody = true;
            checkElement(document.body);
        }

        const currentMutationRecordBatches = mutationRecordBatches;
        mutationRecordBatches = [];

        for (const records of currentMutationRecordBatches) {
            for (const record of records) {
                if (record.type === "attributes" && record.target instanceof HTMLElement) {
                    checkElement(record.target);
                }

                if (record.type === "childList" && record.addedNodes) {
                    for (const node of record.addedNodes) {
                        if (node instanceof HTMLElement) {
                            checkElement(node);
                        }
                    }
                }
            }
        }
    }

    const checkedElements = new WeakSet<HTMLElement>();

    function checkElement(element: HTMLElement) {
        if (checkedElements.has(element)) return;
        checkedElements.add(element);

        // Recursively check all of the element's children...
        for (const childNode of element.childNodes) {
            if (childNode instanceof HTMLElement) {
                checkElement(childNode);
            }
        }

        const {overflowX, overflowY} = getComputedStyle(element);

        const isScrollable =
            overflowX === "scroll" ||
            overflowX === "auto" ||
            overflowY === "scroll" ||
            overflowY === "auto";

        if (!isScrollable) return;

        // If the scrollbar is explicitly disabled, don't log a warning.
        if (element.dataset.scrollbar === "false") return;

        // If we called `initializeScrollbar()` for this element, don't log a warning.
        if (elementsWithInitializedScrollbarForDev?.has(element)) return;

        // We log a warning to the developer so they remember to add custom scrollbar
        // initialization.
        // eslint-disable-next-line no-console
        console.warn(
            'Element is scrollable but doesn\u2019t have our custom scrollbar. Either setup our custom scrollbar with `useScrollbar()` or explicitly disable scrollbars with `data-scrollbar="false"`.',
            element,
        );
    }
}
