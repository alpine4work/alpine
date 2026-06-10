import {RefCallback, useCallback, useEffect, useRef} from "react";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {modalStyles} from "~/client/web/styles/styles.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

let outsideInteractionEventEmitter: EventEmitter<Event> | null = null;

/**
 * Dispatch an event that's not normally considered an outside interaction as an
 * outside interaction, triggering any `useOutsideInteraction()` hooks.
 */
export function dispatchOutsideInteractionEvent(event: Event) {
    outsideInteractionEventEmitter?.emit(event);
}

/**
 * If the user pressed an element outside of the returned ref then we call the
 * provided callback.
 */
export function useOutsidePress(onOutsidePress: (event: Event) => void) {
    return useOutsideInteraction(onOutsidePress, {withOnlyPress: true});
}

export function useOutsideInteraction(
    events:
        | ((event: Event) => void)
        | {
              onOutsideInteraction: (event: Event) => void;
              onInsideInteraction?: (event: Event) => void;
          },
    {
        withOnlyPress = false,
    }: {
        withOnlyPress?: boolean;
    } = {},
): RefCallback<HTMLElement> {
    const ref = useRef<HTMLElement | null>(null);

    const eventsRef = useRef(events);
    useLayoutEffectWithoutServerSideWarning(() => {
        eventsRef.current = events;
    });

    useEffect(() => {
        const listener = (event: Event, alwaysOutsideInteraction: boolean = false) => {
            // We don't want to call our listener if the component this is attached to hasn't
            // mounted.
            if (!ref.current) return;

            // Ignore any events from a `<Modal>` component that's being rendered on top of our
            // ref element. We check this by looking for the nearest parent `<Modal>` component
            // container (if none then `<body>`). If the `<Modal>` component container of our
            // event element is a child of the `<Modal>` component container of our ref element
            // that means the event element's `<Modal>` is rendering on top of our ref element.
            //
            // This works because `<Modal>` renders `<RootOverlayScopeContextProvider>` inside
            // its modal container. Which means any child modals will end up portalling into
            // the parent modal.
            //
            // Here's how ignoring events from a blocking `<Modal>` component is useful. Say
            // you're editing a `<MessageView>` and you want to include a link. So you hit
            // cmd-k to search, find what you're looking for, and copy the link. When you hit
            // escape focus is returned to the message you were in the middle of editing. By
            // ignoring events in `<SearchModal>` we don't cancel editing in the
            // `<MessageView>`.
            if (event.target instanceof Element) {
                const eventModalContainerElement =
                    event.target.closest(`.${modalStyles.modalContainerClassName}`) ??
                    document.body;
                const refModalContainerElement =
                    ref.current.closest(`.${modalStyles.modalContainerClassName}`) ?? document.body;

                if (
                    eventModalContainerElement !== refModalContainerElement &&
                    refModalContainerElement.contains(eventModalContainerElement)
                ) {
                    return;
                }
            }

            if (
                alwaysOutsideInteraction ||
                (event.target instanceof Element && !isElementOwnedBy(ref.current, event.target))
            ) {
                const onOutsideInteraction =
                    typeof eventsRef.current !== "function"
                        ? eventsRef.current.onOutsideInteraction
                        : eventsRef.current;

                onOutsideInteraction(event);
            } else {
                const onInsideInteraction =
                    typeof eventsRef.current !== "function"
                        ? eventsRef.current.onInsideInteraction
                        : undefined;

                onInsideInteraction?.(event);
            }
        };

        const alwaysOutsideInteractionListener = (event: Event) => {
            listener(event, true);
        };

        // Use capture events so that our outside interaction handler runs before everyone
        // else. If it's being used to close an overlay then that will happen first.

        window.addEventListener("pointerdown", listener, true);
        window.addEventListener("touchstart", listener, true);

        if (!withOnlyPress) {
            window.addEventListener("focus", listener, true);

            outsideInteractionEventEmitter ??= new EventEmitter();
            outsideInteractionEventEmitter.addListener(alwaysOutsideInteractionListener);
        }

        return () => {
            window.removeEventListener("pointerdown", listener, true);
            window.removeEventListener("touchstart", listener, true);

            if (!withOnlyPress) {
                window.removeEventListener("focus", listener, true);
                outsideInteractionEventEmitter?.removeListener(alwaysOutsideInteractionListener);
            }
        };
    }, [withOnlyPress]);

    return useCallback((element: HTMLElement | null) => {
        ref.current = element;
    }, []);
}
