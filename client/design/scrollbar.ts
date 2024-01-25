import {RefCallback, useCallback} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {RemLength, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    borderRadius,
    scrollbarClassName,
    scrollbarFadeOutAnimationDurationMs,
    scrollbarFadeOutClassName,
    scrollbarHideClassName,
    scrollbarThumbClassName,
    scrollbarThumbDraggingClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

const scrollbarMargin = "0.5";
const scrollbarInteractiveMargin = "1.5";
const scrollbarWidth = "1.5";
const minScrollbarHeight = "6";

const scrollbarMarginRem = parseRemLengthNumber(spacing[scrollbarMargin]);
const scrollbarInteractiveLeftMarginRem = parseRemLengthNumber(spacing[scrollbarInteractiveMargin]);
const scrollbarThumbWidthRem = parseRemLengthNumber(spacing[scrollbarWidth]);
const minScrollbarHeightRem = parseRemLengthNumber(spacing[minScrollbarHeight]);

const scrollbarWidthRem =
    scrollbarInteractiveLeftMarginRem + scrollbarThumbWidthRem + scrollbarMarginRem;

const scrollbarVisibleAfterScrollDurationMs = 1000;

export function useScrollbar<T extends HTMLElement>({
    inset,
    insetY,
    insetTop,
    insetBottom,
    insetRight,
}: {
    inset?: RemLength | number;
    insetY?: RemLength | number;
    insetTop?: RemLength | number;
    insetBottom?: RemLength | number;
    insetRight?: RemLength | number;
} = {}): RefCallback<T> {
    insetTop = insetTop ?? insetY ?? inset;
    insetBottom = insetBottom ?? insetY ?? inset;
    insetRight = insetRight ?? inset;

    return useLifecycleRef(
        useCallback(
            element => initializeScrollbar(element, {insetTop, insetBottom, insetRight}),
            [insetBottom, insetRight, insetTop],
        ),
    );
}

/**
 * Instead of using native platform scrollbars, we implement our own custom
 * scrollbars in JavaScript. By default, scrollable elements do not have a
 * scrollbar and you must call `initializeScrollbar()` (or the more convenient
 * `useScrollbar()`) to give the element a scrollbar.
 *
 * ## Why custom scrollbars?
 *
 * We use custom scrollbars to ensure design consistency across all platforms.
 * The ideal scrollbar design for our product:
 *
 * 1. Is overlain on top of our content
 * 2. Disappears when the user is not scrolling
 *
 * The scrollbar is more of an indicator of position then an actual tactile
 * control. This is a modern scrollbar design (inspired by mobile). Opposed to
 * chunky old fashioned scrollbars which take horizontal space from the content
 * and have up/down arrow buttons.
 *
 * The MacOS default scrollbar has these two properties. However, the Windows
 * default scrollbar does not. It's a chunky scrollbar that takes horizontal
 * space. On MacOS you can also configure (at an operating system level)
 * scrollbars to always be displayed using a chunky non-overlain design.
 *
 * This makes scrollbars a little challenging to design around. Your screen
 * needs to work well with any platform scrollbar style. There are some [CSS
 * customization options][1] for scrollbars but they're quite limited and
 * different browsers support different properties. The CSS customization
 * options currently do not support overlain scrollbars.
 *
 * So for design consistency purposes we implement our own scrollbars.
 *
 * In addition to cross platform design consistency, we get very powerful
 * design customization opportunities. For example, we support adding
 * additional inset for the scrollbar. This is great in our `<MessageInput>`
 * component where the scrollbar is in a container with some aggressive
 * `border-radius`. This is also useful for some views in our task product
 * where after you scroll for a bit you get a sticky header (e.g. the notepad
 * view where you scroll past the active task section). In a view like that we
 * don't want the scrollbar to cover the sticky header. That breaks the sticky
 * header physical material analogy.
 *
 * We use a lot of virtual scroll views for data heavy screens. Scrollbars and
 * virtualized views are tricky since content is being loaded/resized while you
 * scroll. In the future we should explore ways to make the scrollbar feel more
 * fluid while lazy loading data so it doesn't jump around. For now we emulate
 * the same behavior as a native scrollbar.
 *
 * ## How do we implement our custom scrollbar?
 *
 * We could use a library like [OverlayScrollbars][2] but instead we implement
 * our scrollbars from scratch. This is because I couldn't find a library that
 * does NOT use the `scroll` event to implement the scrollbar.
 *
 * The problem with using the `scroll` event to implement a scroll-linked
 * effect is in modern browsers scrolling happens asynchronously in a separate
 * thread so the user doesn't see lag. Any UI that updates itself by listening
 * to the `scroll` event will end up looking janky or jittery since it's
 * out-of-sync with the scroll rendering thread. Firefox has [good
 * documentation on the scroll-linked effects problem][3] with some solutions.
 * One common solution is to use `position: sticky` to build UI like sticky
 * headers.
 *
 * Another solution is to make the `scroll` event synchronous! [Monday.com has
 * done this in their grid view UI][4]. The way this approach works is you
 * listen for the `wheel` event, call `event.preventDefault()`, then manually
 * update the element's `scrollTop`. While this works, it makes it harder to
 * achieve butter smooth 60fps scrolling since the browser has to wait for
 * JavaScript code to execute in between each scroll frame.
 *
 * So we want to use a solution like `position: sticky` or
 * `transform: matrix3d()` to get buttery smooth scrolling animations.
 *
 * At first we invented our own approach for scrollbars using
 * `position: sticky` but later came across a better approach which [uses
 * `transform: matrix3d()` on the Chrome blog][5]. The `transform: matrix3d()`
 * approach works nicely with iOS overscroll whereas our `position: sticky`
 * approach didn't.
 *
 * Once [CSS Houdini low-level APIs][6] gets broad support, presumably we could
 * implement custom scrollbars with those APIs.
 *
 * [1]: https://css-tricks.com/the-current-state-of-styling-scrollbars-in-css/
 * [2]: https://kingsora.github.io/OverlayScrollbars/
 * [3]: https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html
 * [4]: https://engineering.monday.com/our-journey-to-understand-scrolling-across-different-browsers/
 * [5]: https://developer.chrome.com/blog/custom-scrollbar/
 * [6]: https://developer.mozilla.org/en-US/docs/Web/Guide/Houdini
 */
export function initializeScrollbar(
    element: HTMLElement,
    {
        insetTop = 0,
        insetBottom = 0,
        insetRight = 0,
    }: {
        insetTop?: RemLength | number;
        insetBottom?: RemLength | number;
        insetRight?: RemLength | number;
    } = {},
): () => void {
    {
        const {perspective, position} = getComputedStyle(element);

        // We need to set `perspective` and `perspective-origin` for our scrollbar to
        // work. If needed, presumably we could make scrollbars work with whatever
        // `perspective` value but for now it's simpler to not allow perspective
        // customization.
        //
        // We don't check that `perspective-origin` is correct since the computed style
        // is `50% 50%` resolved to pixels.
        assert(
            perspective === "none",
            "`perspective` CSS style should be initial value on scrollable element",
        );
        assert(
            !element.style.perspective,
            "There shouldn't be a `perspective` inline CSS style on scrollable element",
        );
        assert(
            !element.style.perspectiveOrigin,
            "There shouldn't be a `perspective-origin` inline CSS style on scrollable element",
        );

        // Scrollbar will lay itself out with `position: absolute` so the scrollable
        // element should form a containing block. The easiest way to do this is by
        // setting `position: relative` on the scrollable element but here are some
        // other ways:
        // https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block
        assert(
            position === "relative",
            "Scrollable element must be a containing block (set `position: relative` on the element)",
        );
    }

    let visibleAfterScrollTimeout: Timeout | null = null;

    /* ========================================================================== *\
     *                               Construct DOM                                *
    \* ========================================================================== */

    const scrollbarElement = document.createElement("div");

    const scrollbarThumbElement = document.createElement("div");
    scrollbarElement.appendChild(scrollbarThumbElement);

    scrollbarElement.className = scrollbarClassName;
    scrollbarElement.style.position = "absolute";
    scrollbarElement.style.top = "0";
    scrollbarElement.style.right = "0";
    scrollbarElement.style.transformOrigin = "top right";
    scrollbarElement.style.width =
        insetRight !== 0
            ? typeof insetRight === "number"
                ? `calc(${scrollbarWidthRem}rem + ${insetRight}px)`
                : `${scrollbarWidthRem + parseRemLengthNumber(insetRight)}rem`
            : `${scrollbarWidthRem}rem`;

    scrollbarThumbElement.className = scrollbarThumbClassName;
    scrollbarThumbElement.style.position = "absolute";
    scrollbarThumbElement.style.top = `${scrollbarMarginRem}rem`;
    scrollbarThumbElement.style.bottom = `${scrollbarMarginRem}rem`;
    scrollbarThumbElement.style.left = `${scrollbarInteractiveLeftMarginRem}rem`;
    scrollbarThumbElement.style.right =
        insetRight !== 0
            ? typeof insetRight === "number"
                ? `calc(${scrollbarMarginRem}rem + ${insetRight}px)`
                : `${scrollbarMarginRem + parseRemLengthNumber(insetRight)}rem`
            : `${scrollbarMarginRem}rem`;
    scrollbarThumbElement.style.borderRadius = borderRadius["full"];

    /* ========================================================================== *\
     *                        Handle resizing & scrolling                         *
    \* ========================================================================== */

    let sizes: {
        scrollHeight: number;
        clientHeight: number;
    } | null = null;

    const handleResize = () => {
        const clientHeight = element.clientHeight;
        const scrollHeight = element.scrollHeight;

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
            scrollbarElement.classList.add(scrollbarHideClassName);
            scrollbarElement.classList.remove(scrollbarFadeOutClassName);

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

        const insetTopPx =
            typeof insetTop === "string" ? parseRemLengthNumber(insetTop) * remPx : insetTop;

        const insetBottomPx =
            typeof insetBottom === "string"
                ? parseRemLengthNumber(insetBottom) * remPx
                : insetBottom;

        const scrollbarHeight = Math.max(
            clientHeight * ((clientHeight - insetTopPx - insetBottomPx) / scrollHeight),
            minScrollbarHeightRem * remPx,
        );

        const scaleFactor =
            (clientHeight - scrollbarHeight - insetTopPx - insetBottomPx) /
            (scrollHeight - clientHeight);

        const transform = [
            // prettier-ignore
            `matrix3d(${[
                1, 0, 0, 0,
                0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, -1,
                ].join(", ")})`,
            `scale(${1 / scaleFactor})`,
            `translateZ(${1 - 1 / scaleFactor}px)`,
            "translateZ(-2px)",
        ];

        if (insetTopPx > 0) {
            transform.push(`translateY(${insetTopPx}px)`);
        }

        scrollbarElement.style.height = `${scrollbarHeight}px`;
        scrollbarElement.style.transform = transform.join(" ");
    };

    // Temporarily show the scrollbar while the user is scrolling then fade it out
    // after a timeout.
    const handleScroll = () => {
        // If the pointer is over our scrollbar then it doesn't disappear until the
        // pointer leaves the scrollbar.
        if (isPointerOver) return;

        // Don't hide the scrollbar while we're dragging it.
        if (dragState) return;

        restartVisibleAfterScrollTimeout();
    };

    const restartVisibleAfterScrollTimeout = () => {
        if (sizes === null || sizes.scrollHeight <= sizes.clientHeight) return;

        scrollbarElement.classList.remove(scrollbarHideClassName);
        scrollbarElement.classList.remove(scrollbarFadeOutClassName);

        visibleAfterScrollTimeout?.clear();
        visibleAfterScrollTimeout = null;

        let timeout2: Timeout | null = null;

        const timeout1 = createTimeout(() => {
            scrollbarElement.classList.add(scrollbarFadeOutClassName);

            timeout2 = createTimeout(() => {
                scrollbarElement.classList.add(scrollbarHideClassName);
                scrollbarElement.classList.remove(scrollbarFadeOutClassName);
            }, scrollbarFadeOutAnimationDurationMs);
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
    scrollbarElement.classList.add(scrollbarHideClassName);

    // Run resize function to initialize styles.
    handleResize();

    /* ========================================================================== *\
     *                           Handle drag to scroll                            *
    \* ========================================================================== */

    // We don't need to `removeEventListener()` for pointer event listeners on
    // `scrollbarThumbHitElement` since `scrollbarThumbHitElement` is detached from
    // the DOM when the scrollbar is destroyed.

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

        // If we're in a menu and the user tries to drag the scrollbar, prevent default
        // so the menu doesn't close.
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

        scrollbarElement.classList.remove(scrollbarHideClassName);
        scrollbarElement.classList.remove(scrollbarFadeOutClassName);

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

    scrollbarElement.addEventListener("pointerdown", startDrag);

    scrollbarElement.addEventListener("pointerenter", () => {
        isPointerOver = true;

        if (!dragState && sizes !== null && sizes.scrollHeight > sizes.clientHeight) {
            scrollbarElement.classList.remove(scrollbarHideClassName);
            scrollbarElement.classList.remove(scrollbarFadeOutClassName);

            visibleAfterScrollTimeout?.clear();
            visibleAfterScrollTimeout = null;
        }
    });

    scrollbarElement.addEventListener("pointerleave", () => {
        isPointerOver = false;

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

    element.style.perspective = "1px";
    element.style.perspectiveOrigin = "top right";

    element.appendChild(scrollbarElement);

    elementsWithInitializedScrollbarForDev?.add(element);
    addResizeListenerForElement(element, handleResize);
    element.addEventListener("scroll", handleScroll);

    const listeningToChildElementResizes = new Set<HTMLElement>();
    for (const childNode of element.childNodes) {
        if (!(childNode instanceof HTMLElement)) continue;

        // Ignore our scrollbar element.
        if (childNode === scrollbarElement) continue;

        addResizeListenerForElement(childNode, handleResize);
        listeningToChildElementResizes.add(childNode);
    }

    // We need to listen to:
    //
    // - `element.clientHeight` changes
    // - `element.scrollHeight` changes
    //
    // `element.clientHeight` changes are covered by listening to resizes on
    // `element`. To detect `element.scrollHeight` changes we need to listen to
    // resizes on all children elements. So setup a `MutationObserver` that tells
    // us when children are added/removed so we can listen to resizes for them.
    const mutationObserver = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === "childList") {
                if (record.addedNodes && record.addedNodes.length > 0) {
                    for (const addedNode of record.addedNodes) {
                        if (!(addedNode instanceof HTMLElement)) continue;

                        // Ignore our scrollbar element.
                        if (addedNode === scrollbarElement) continue;

                        // Adding a resize listener will make an initial call to `handleResize()`.
                        // We don't need to make an additional call.
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
        /* ========================================================================== *\
         *                     Disconnect from scrollable element                     *
        \* ========================================================================== */

        mutationObserver.disconnect();

        for (const element of listeningToChildElementResizes)
            removeResizeListenerForElement(element, handleResize);

        listeningToChildElementResizes.clear();

        element.removeEventListener("scroll", handleScroll);
        removeResizeListenerForElement(element, handleResize);
        elementsWithInitializedScrollbarForDev?.delete(element);

        element.removeChild(scrollbarElement);

        element.style.removeProperty("perspective");
        element.style.removeProperty("perspective-origin");
    };
}

let wasScrollbarAuditorInstalled = false;

const elementsWithInitializedScrollbarForDev: WeakSet<HTMLElement> | null =
    process.env.NODE_ENV !== "production" ? new WeakSet() : null;

/**
 * Audits the entire DOM tree and if we see a scrollable element mount without
 * a custom scrollbar we log a warning so the developer knows to fix it.
 *
 * Instead of using native browser scrollbars, we implement our own custom
 * scrollbars in JavaScript. This allows us to maintain design consistency
 * across all platforms we support. But each scrollbar needs some manual
 * configuration by the developer. This auditor makes sure we don't miss any
 * scrollbars.
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

            // Throttle auditing to every 1s since we don't want auditing to impact main
            // thread interaction performance.
            setTimeout(() => {
                // Use the React scheduler to schedule an idle callback.
                // `requestIdleCallback()` is not implemented in Safari. Generally we recommend
                // using the React scheduler since it has centralized knowledge of all our
                // tasks (including UI rendering).
                //
                // Since the `audit()` function could be expensive maybe we may want to check
                // with the `scheduler` if we should yield back to the main thread and resume
                // later.
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
            'Element is scrollable but doesn\'t have our custom scrollbar. Either setup our custom scrollbar with `useScrollbar()` or explicitly disable scrollbars with `data-scrollbar="false"`.',
            element,
        );
    }
}
