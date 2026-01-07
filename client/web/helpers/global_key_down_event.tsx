import {
    ReactNode,
    Ref,
    createContext,
    forwardRef,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

type GlobalKeyDownEventContext = {
    readonly childListeners: Set<
        (event: KeyboardEvent & {wasPropagationStopped(): boolean}) => void
    >;
    readonly modalChildListeners: Set<
        (event: KeyboardEvent & {wasPropagationStopped(): boolean}) => void
    >;
};

const GlobalKeyDownEventContext = createContext<GlobalKeyDownEventContext | null>(null);

const globalKeyDownEventContextForTest: GlobalKeyDownEventContext | null = import.meta.jest
    ? {
          childListeners: new Set(),
          modalChildListeners: new Set(),
      }
    : null;

/**
 * Component for handling keyboard shortcuts using DOM event propagation APIs.
 *
 * Let's say you want to implement a keyboard shortcut like "Escape" to close a
 * popup. If you add `onKeyDown` to some `<div>` in your popup it will only
 * fire if an element inside that `<div>` is focused. If the user clicked
 * around then nothing in your `<div>` is focused and it won't be able to
 * handle an escape keypress.
 *
 * The solution is to attach your `keydown` event handler to `document`. Now
 * you'll see all keyboard events regardless of what has focus.
 *
 * However, what happens if you have two popups? Pressing "Escape" should
 * probably only close one of them, not all of them. So the popups need to
 * coordinate with each other to only close one at a time.
 *
 * The `<GlobalKeyDownEvent>` component provides that coordination! At the root
 * of the DOM we attach a `keydown` listener to the `document`. When we a
 * `keydown` event bubbles to `document` (which means it wasn't handled by a
 * text input) we call the deepest child `<GlobalKeyDownEvent>` component's
 * listeners and bubble up to parents. If `event.stopPropagation()` or
 * is called then `<GlobalKeyDownEvent>` respects that and stops bubbling.
 *
 * If you have multiple sibling `<GlobalKeyDownEvent>` then their listeners are
 * called in the reverse order in which the components were mounted. So if the
 * last component to mount calls `event.stopPropagation()` we will not call the
 * listeners of components that mounted later.
 *
 * You may use `onGlobalKeyDownBeforeChildren` if you want an event listener
 * that runs, well, before its child event listeners. This is different from a
 * capture event listener. A capture event listener would run before `keydown`
 * events are processed by the focused element. `onGlobalKeyDownBeforeChildren`
 * still runs in the bubbling phase just in reverse order.
 *
 * ### Bubbling example
 *
 * - Component A
 *   - Component A1
 *   - Component A2
 *   - Component A3
 * - Component B
 *   - Component B1
 *   - Component B2
 *   - Component B3
 *
 * Normally, we call events in the following order:
 *
 * - Component A `onGlobalKeyDownBeforeChildren()`
 * - Component A1 `onGlobalKeyDownBeforeChildren()`
 * - Component A1 `onGlobalKeyDown()`
 * - Component A2 `onGlobalKeyDownBeforeChildren()`
 * - Component A2 `onGlobalKeyDown()`
 * - Component A3 `onGlobalKeyDownBeforeChildren()`
 * - Component A3 `onGlobalKeyDown()`
 * - Component A `onGlobalKeyDown()`
 * - Component B `onGlobalKeyDownBeforeChildren()`
 * - Component B1 `onGlobalKeyDownBeforeChildren()`
 * - Component B1 `onGlobalKeyDown()`
 * - Component B2 `onGlobalKeyDownBeforeChildren()`
 * - Component B2 `onGlobalKeyDown()`
 * - Component B3 `onGlobalKeyDownBeforeChildren()`
 * - Component B3 `onGlobalKeyDown()`
 * - Component B `onGlobalKeyDown()`
 *
 * The order in which we call listeners at a given level of the tree is based
 * on the order in which they were mounted. If component A was mounted after
 * component B then we will call all of component B's listeners first,
 * then A's.
 *
 * If component A2 calls `event.stopPropagation()` in `onGlobalKeyDown()` we
 * will call the following listeners:
 *
 * - Component A `onGlobalKeyDownBeforeChildren()`
 * - Component A1 `onGlobalKeyDownBeforeChildren()`
 * - Component A1 `onGlobalKeyDown()`
 * - Component A2 `onGlobalKeyDownBeforeChildren()`
 * - Component A2 `onGlobalKeyDown()` (calls `event.stopImmediatePropagation()`)
 * - Component A3 (skipped)
 * - Component A (skipped)
 * - Component B (skipped)
 */
export function GlobalKeyDownEvent({
    isDisabled = false,
    onGlobalKeyDown,
    onGlobalKeyDownBeforeChildren,
    children,
}: {
    isDisabled?: boolean;
    onGlobalKeyDown?: (event: KeyboardEvent) => void;
    onGlobalKeyDownBeforeChildren?: (event: KeyboardEvent) => void;
    children?: ReactNode;
}) {
    const parentContext = useContext(GlobalKeyDownEventContext) ?? globalKeyDownEventContextForTest;
    assert(parentContext, "Expected a parent `<GlobalKeyDownRootContextProvider>` component");

    const [childContext] = useState<GlobalKeyDownEventContext>(() => ({
        childListeners: new Set(),
        modalChildListeners: parentContext.modalChildListeners,
    }));

    const onGlobalKeyDownRef = useRef(onGlobalKeyDown);
    const onGlobalKeyDownBeforeChildrenRef = useRef(onGlobalKeyDownBeforeChildren);

    useLayoutEffectWithoutServerSideWarning(() => {
        onGlobalKeyDownRef.current = onGlobalKeyDown;
        onGlobalKeyDownBeforeChildrenRef.current = onGlobalKeyDownBeforeChildren;
    });

    const listener = useMemo(
        () =>
            createListener(
                childContext.childListeners,
                // eslint-disable-next-line react-compiler/react-compiler
                event => onGlobalKeyDownRef.current?.(event),
                // eslint-disable-next-line react-compiler/react-compiler
                event => onGlobalKeyDownBeforeChildrenRef.current?.(event),
            ),
        [childContext.childListeners],
    );

    useEffect(() => {
        // Disabling not only prevents our listeners from being called but also all
        // child listeners of this component.
        if (isDisabled) return;

        parentContext.childListeners.add(listener);
        return () => {
            parentContext.childListeners.delete(listener);
        };
    }, [isDisabled, listener, parentContext.childListeners]);

    return (
        <GlobalKeyDownEventContext.Provider value={childContext}>
            {children}
        </GlobalKeyDownEventContext.Provider>
    );
}

/**
 * When this component is rendered, all sibling `<GlobalKeyDownEvent>`s are disabled.
 * Only child `<GlobalKeyDownEvent>`s may run. Modals block interactivity of all
 * elements below. Including global keydown event handling.
 */
export function GlobalKeyDownEventModal({children}: {children?: ReactNode}) {
    const parentContext = useContext(GlobalKeyDownEventContext) ?? globalKeyDownEventContextForTest;
    assert(parentContext, "Expected a parent `<GlobalKeyDownRootContextProvider>` component");

    const [childContext] = useState<GlobalKeyDownEventContext>(() => ({
        childListeners: new Set(),
        modalChildListeners: new Set(),
    }));

    const listener = useMemo(
        () => createListener(childContext.childListeners, null, null),
        [childContext.childListeners],
    );

    const modalListener = useMemo(
        () => createListener(childContext.modalChildListeners, null, null),
        [childContext.modalChildListeners],
    );

    useEffect(() => {
        const actualListener = (event: KeyboardEvent & {wasPropagationStopped(): boolean}) => {
            if (childContext.modalChildListeners.size > 0) {
                modalListener(event);
            } else {
                listener(event);
            }
        };

        parentContext.modalChildListeners.add(actualListener);
        return () => {
            parentContext.modalChildListeners.delete(actualListener);
        };
    }, [
        childContext.modalChildListeners,
        listener,
        modalListener,
        parentContext.modalChildListeners,
    ]);

    return (
        <GlobalKeyDownEventContext.Provider value={childContext}>
            {children}
        </GlobalKeyDownEventContext.Provider>
    );
}

export function GlobalKeyDownRootContextProvider({children}: {children?: ReactNode}) {
    const parentContext = useContext(GlobalKeyDownEventContext);
    assert(
        !parentContext,
        "Expected this to be the root `<GlobalKeyDownRootContextProvider>` component",
    );

    const [childContext] = useState<GlobalKeyDownEventContext>(() => ({
        childListeners: new Set(),
        modalChildListeners: new Set(),
    }));

    useEffect(() => {
        const modalListener = createListener(childContext.modalChildListeners, null, null);
        const listener = createListener(childContext.childListeners, null, null);

        const actualListener = (baseEvent: KeyboardEvent) => {
            let wasPropagationStopped = false;

            const event = Object.assign(new KeyboardEvent(baseEvent.type, baseEvent), {
                wasPropagationStopped: () => wasPropagationStopped,
            });

            const originalPreventDefault = event.preventDefault.bind(event);
            const originalStopPropagation = event.stopPropagation.bind(event);
            const originalStopImmediatePropagation = event.stopImmediatePropagation.bind(event);

            event.preventDefault = () => {
                baseEvent.preventDefault();
                originalPreventDefault();
            };

            event.stopPropagation = () => {
                wasPropagationStopped = true;
                baseEvent.stopPropagation();
                originalStopPropagation();
            };

            event.stopImmediatePropagation = () => {
                wasPropagationStopped = true;
                baseEvent.stopImmediatePropagation();
                originalStopImmediatePropagation();
            };

            if (childContext.modalChildListeners.size > 0) {
                modalListener(event);
            } else {
                listener(event);
            }
        };

        // IMPORTANT: Attaching to `window` instead of `document` is important here!
        // React attaches its `keydown` listener on `document` so if a React handler
        // calls `event.stopPropagation()` it stops bubbling to `window` but doesn't
        // stop another listener on `document` from being called.
        //
        // See: https://github.com/facebook/react/issues/4335#issuecomment-421705171
        window.addEventListener("keydown", actualListener);
        return () => {
            window.removeEventListener("keydown", actualListener);
        };
    }, [childContext.childListeners, childContext.modalChildListeners]);

    return (
        <GlobalKeyDownEventContext.Provider value={childContext}>
            {children}
        </GlobalKeyDownEventContext.Provider>
    );
}

export type GlobalKeyDownManualContextProviderRef = {
    dispatchEvent(event: KeyboardEvent): void;
};

const GlobalKeyDownManualContextProviderForwardRef = forwardRef(GlobalKeyDownManualContextProvider);
export {GlobalKeyDownManualContextProviderForwardRef as GlobalKeyDownManualContextProvider};

/**
 * Can be used to manually fire a subtree's global key down listeners. Useful
 * if you want to increase the priority of some listeners.
 */
function GlobalKeyDownManualContextProvider(
    {children}: {children?: ReactNode},
    ref: Ref<GlobalKeyDownManualContextProviderRef>,
) {
    const parentContext = useContext(GlobalKeyDownEventContext) ?? globalKeyDownEventContextForTest;
    assert(parentContext, "Expected a parent `<GlobalKeyDownRootContextProvider>` component");

    const [childContext] = useState<GlobalKeyDownEventContext>(() => ({
        childListeners: new Set(),
        modalChildListeners: parentContext.modalChildListeners,
    }));

    useImperativeHandle(ref, () => {
        const listener = createListener(childContext.childListeners, null, null);
        return {dispatchEvent: listener};
    }, [childContext.childListeners]);

    return (
        <GlobalKeyDownEventContext.Provider value={childContext}>
            {children}
        </GlobalKeyDownEventContext.Provider>
    );
}

function createListener(
    childListeners: Set<(event: KeyboardEvent & {wasPropagationStopped(): boolean}) => void>,
    listener: ((event: KeyboardEvent) => void) | null,
    captureListener: ((event: KeyboardEvent) => void) | null,
) {
    return (event: KeyboardEvent & {wasPropagationStopped(): boolean}) => {
        if (captureListener !== null) {
            try {
                captureListener(event);
            } catch (error) {
                // Errors in listeners should not stop event handling.
                scheduleUncaughtError(error);
            }
        }

        if (event.wasPropagationStopped()) return;

        // We call child listeners in reverse order so that components mounted later
        // have the opportunity to intercept keyboard events first.
        for (const listener of Array.from(childListeners).reverse()) {
            listener(event);
            if (event.wasPropagationStopped()) return;
        }

        if (listener !== null) {
            try {
                listener(event);
            } catch (error) {
                // Errors in listeners should not stop event handling.
                scheduleUncaughtError(error);
            }
        }
    };
}
