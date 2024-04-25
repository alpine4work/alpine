import {Memo, ReactNode, RefObject, createContext, useCallback, useContext, useState} from "react";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {mobileBottomBarKeyboardToolbarHeightRem} from "~/client/design/mobile_bottom_bar.js";
import {throwIfRendering} from "~/client/helpers/lifecycle/throw_if_rendering.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/helpers/use_resize_observer.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {InternalError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

type BottomBarFrameContext = {
    currentBottomBarHeight: {
        readonly visibleMobileKeyboard: number;
        readonly hiddenMobileKeyboard: number;
    } | null;
    bottomBarFrameChangeEmitter: EventEmitter<{
        oldBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
        newBottomBarHeight: {
            readonly visibleMobileKeyboard: number;
            readonly hiddenMobileKeyboard: number;
        };
    }> | null;
    bottomBarFrames: Set<{readonly height: number; readonly withMobileKeyboardToolbar: boolean}>;
};

const BottomBarFrameContext = createContext<BottomBarFrameContext | null>(null);

function getInitialBottomBarFrameContext(): BottomBarFrameContext {
    return {
        currentBottomBarHeight: null,
        bottomBarFrameChangeEmitter: null,
        bottomBarFrames: new Set(),
    };
}

const bottomBarFrameContextForTest: BottomBarFrameContext | null = import.meta.jest
    ? getInitialBottomBarFrameContext()
    : null;

function useBottomBarFrameContext(): BottomBarFrameContext {
    const context = useContext(BottomBarFrameContext);

    if (context === null) {
        // In Jest tests, act like we are not in the initial render unless an
        // `<BottomBarFrameContextProvider>` is explicitly used.
        if (import.meta.jest) return assertExists(bottomBarFrameContextForTest);

        throw new InternalError("Must be rendered in an `<BottomBarFrameContextProvider>`");
    }

    return context;
}

export function BottomBarFrameContextProvider({children}: {children?: ReactNode}) {
    const [context] = useState<BottomBarFrameContext>(getInitialBottomBarFrameContext);

    return (
        <BottomBarFrameContext.Provider value={context}>{children}</BottomBarFrameContext.Provider>
    );
}

const zeroBottomBarHeight = {visibleMobileKeyboard: 0, hiddenMobileKeyboard: 0};

/**
 * Get the current bottom bar height.
 *
 * The returned function reads mutable state so you may not call it
 * during React renders.
 */
export function useGetCurrentBottomBarHeight(): Memo<
    () => {
        readonly visibleMobileKeyboard: number;
        readonly hiddenMobileKeyboard: number;
    }
> {
    const context = useContext(BottomBarFrameContext);

    return useCallback(() => {
        // We read mutable state (`context.currentBottomBarHeight`) so this function
        // can't be called during a React render.
        throwIfRendering();

        if (context === null) return zeroBottomBarHeight;

        return (context.currentBottomBarHeight ??= zeroBottomBarHeight);
    }, [context]);
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarFrame<Element extends HTMLElement>(
    elementRef: RefObject<Element>,
    {
        isDisabled = false,
        withMobileKeyboardToolbar = false,
    }: {isDisabled?: boolean; withMobileKeyboardToolbar?: boolean} = {},
) {
    const context = useBottomBarFrameContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInertNativeMobileRoute) return;
        if (isDisabled) return;

        const element = assertExists(elementRef.current);

        let isCancelled = false;
        let hasFinishedEffectSetup = false;
        let hasCalledHandleResizeDuringEffectSetup = false;

        // Emit change after a microtask so it doesn't run as part of React's
        // mounting phase which may have not finished setting up refs that may be used
        // by event emitter listeners.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            hasFinishedEffectSetup = true;
            if (!hasCalledHandleResizeDuringEffectSetup) {
                handleResize();
            }
        });

        let currentHeight: number | null = null;
        let unregister: (() => void) | null = null;

        const handleResize = () => {
            if (!hasFinishedEffectSetup) {
                hasCalledHandleResizeDuringEffectSetup = true;
                return;
            }

            const {height} = element.getBoundingClientRect();

            if (currentHeight !== height) {
                currentHeight = height;

                const oldUnregister = unregister;
                unregister = registerBottomBarFrame(context, height, {withMobileKeyboardToolbar});

                // Make sure to unregister AFTER registering the new height. That way if the
                // height didn't change there will be no update notifications.
                oldUnregister?.();
            }
        };

        // We appear to have no visual issues when this resizes. Mainly adding a
        // resize element listener to this element causes a suppressed warning from
        // `<VirtualizedScrollView>` to be logged.
        addSuppressResizeLoopErrorNotificationForElement(element);

        addResizeListenerForElement(element, handleResize);

        return () => {
            isCancelled = true;

            removeResizeListenerForElement(element, handleResize);
            removeSuppressResizeLoopErrorNotificationForElement(element);

            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            //
            // Double microtask so microtasks scheduled by effect React mount handlers can
            // run before we finish unmounting and we can skip sending an event if a
            // remount doesn't change the height.
            scheduleMicrotask(() => {
                scheduleMicrotask(() => {
                    unregister?.();
                });
            });
        };
    }, [context, elementRef, isDisabled, isInertNativeMobileRoute, withMobileKeyboardToolbar]);
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
export function useRegisterBottomBarMobileKeyboardToolbarFrame({
    isDisabled = false,
}: {isDisabled?: boolean} = {}) {
    const context = useBottomBarFrameContext();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInertNativeMobileRoute) return;
        if (isDisabled) return;

        let isCancelled = false;
        let unregister: (() => void) | null = null;

        // Emit change after a microtask so it doesn't run as part of React's
        // unmounting phase. If React immediately remounts and we re-register with the
        // same height it means we'll end up emitting no events. If React remounts with
        // a different height then we'll only end up emitting one event.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            unregister = registerBottomBarMobileKeyboardToolbarFrame(context);
        });

        return () => {
            isCancelled = true;

            // Emit change after a microtask so it doesn't run as part of React's
            // unmounting phase. If React immediately remounts and we re-register with the
            // same height it means we'll end up emitting no events. If React remounts with
            // a different height then we'll only end up emitting one event.
            //
            // Double microtask so microtasks scheduled by effect React mount handlers can
            // run before we finish unmounting and we can skip sending an event if a
            // remount doesn't change the height.
            scheduleMicrotask(() => {
                scheduleMicrotask(() => {
                    unregister?.();
                });
            });
        };
    }, [context, isDisabled, isInertNativeMobileRoute]);
}

/**
 * Register a mobile bottom bar for the height calculations of
 * `subscribeToMobilBottomBarFrameChange()`.
 */
function registerBottomBarFrame(
    context: BottomBarFrameContext,
    height: number,
    {withMobileKeyboardToolbar = false}: {withMobileKeyboardToolbar?: boolean} = {},
): () => void {
    const bottomBarFrame = {height, withMobileKeyboardToolbar};

    (context.bottomBarFrames ??= new Set()).add(bottomBarFrame);

    const oldBottomBarHeight = (context.currentBottomBarHeight ??= {
        visibleMobileKeyboard: 0,
        hiddenMobileKeyboard: 0,
    });
    const newBottomBarHeight = {
        visibleMobileKeyboard: getMobileBottomBarHeight(context, true),
        hiddenMobileKeyboard: getMobileBottomBarHeight(context, false),
    };
    if (
        oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
        oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
    ) {
        context.currentBottomBarHeight = newBottomBarHeight;
        (context.bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
            oldBottomBarHeight,
            newBottomBarHeight: context.currentBottomBarHeight,
        });
    }

    return () => {
        (context.bottomBarFrames ??= new Set()).delete(bottomBarFrame);

        const oldBottomBarHeight = (context.currentBottomBarHeight ??= {
            visibleMobileKeyboard: 0,
            hiddenMobileKeyboard: 0,
        });
        const newBottomBarHeight = {
            visibleMobileKeyboard: getMobileBottomBarHeight(context, true),
            hiddenMobileKeyboard: getMobileBottomBarHeight(context, false),
        };
        if (
            oldBottomBarHeight.hiddenMobileKeyboard !== newBottomBarHeight.hiddenMobileKeyboard ||
            oldBottomBarHeight.visibleMobileKeyboard !== newBottomBarHeight.visibleMobileKeyboard
        ) {
            context.currentBottomBarHeight = newBottomBarHeight;
            (context.bottomBarFrameChangeEmitter ??= new EventEmitter()).emit({
                oldBottomBarHeight,
                newBottomBarHeight: context.currentBottomBarHeight,
            });
        }
    };
}

/**
 * Register a mobile bottom bar that just provides a keyboard toolbar for the
 * height calculations of `subscribeToMobilBottomBarFrameChange()`.
 */
function registerBottomBarMobileKeyboardToolbarFrame(context: BottomBarFrameContext) {
    return registerBottomBarFrame(context, 0, {withMobileKeyboardToolbar: true});
}

function getMobileBottomBarHeight(
    context: BottomBarFrameContext,
    isMobileKeyboardVisible: boolean,
): number {
    const remPx = getRemPxWithoutListening();

    let bottomBarHeight = 0;

    for (const bottomBar of context.bottomBarFrames ?? []) {
        bottomBarHeight = Math.max(
            bottomBarHeight,
            bottomBar.height +
                (isMobileKeyboardVisible && bottomBar.withMobileKeyboardToolbar
                    ? mobileBottomBarKeyboardToolbarHeightRem * remPx
                    : 0),
        );
    }

    return bottomBarHeight;
}

/**
 * Subscribe to changes in mobile bottom bar frame sizes.
 *
 * Does nothing outside of mobile environments.
 */
export function useSubscribeToBottomBarFrameChange(): Memo<
    (
        listener: (event: {
            readonly oldBottomBarHeight: {
                readonly visibleMobileKeyboard: number;
                readonly hiddenMobileKeyboard: number;
            };
            readonly newBottomBarHeight: {
                readonly visibleMobileKeyboard: number;
                readonly hiddenMobileKeyboard: number;
            };
        }) => void,
    ) => () => void
> {
    const context = useBottomBarFrameContext();

    return useCallback(
        listener => {
            return (context.bottomBarFrameChangeEmitter ??= new EventEmitter()).subscribe(listener);
        },
        [context],
    );
}
