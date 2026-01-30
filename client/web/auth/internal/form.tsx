import {
    ComponentProps,
    ReactElement,
    ReactNode,
    Ref,
    cloneElement,
    useImperativeHandle,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export const formErrorFontSize = "75";
export const formErrorMarginTop = "4";

export type FormRef = {
    submit(): void;
};

// NOTE(calebmer, 2025-01-07): Could be upgraded to `//client/web/design`
// someday. A `<form>` component that handles submissions on the client.
// Accessible and handles all the standard form behaviors like enter in an
// input to submit.
export function Form({
    ref,
    submitErrorTitle,
    onSubmit,
    button,
    children,
    afterButton,
}: {
    ref?: Ref<FormRef>;
    submitErrorTitle: string;
    onSubmit: () => MaybePromise<void>;
    button: ReactElement<ComponentProps<typeof Button>, typeof Button>;
    children?: ReactNode;
    afterButton?: ReactNode;
}) {
    assert(
        button.type === Button,
        "`<Form>` component\u2019s `button` prop must be a `<Button>` component",
    );

    assert(
        !button.props.onPress,
        "`<Form>` component\u2019s `button` prop must not have an `onPress` prop (the `<Form>` component handles submission)",
    );

    const isDisabled = button.props.isDisabled ?? false;

    const [isButtonPressed, setIsButtonPressed] = useState(false);
    if (isButtonPressed && isDisabled) setIsButtonPressed(false);

    const [isPending, setIsPending] = useState(false);
    const [errorState, setErrorState] = useState<{error: unknown} | null>(null);

    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    // Clear the error state once we start showing the pending spinner.
    if (shouldShowPendingSpinner && errorState) {
        setErrorState(null);
    }

    const handleSubmit = useEvent(() => {
        // Don't submit again if the form is disabled or already pending.
        if (isDisabled || isPending) return;

        let promise;
        try {
            promise = onSubmit?.();
        } catch (error) {
            setErrorState({error});
            return;
        }

        // If the press returns a promise:
        //
        // - Show a loading spinner after a short delay
        // - Show a toast if there was an error
        if (!(promise instanceof Promise)) {
            // Clear the error state once submission completes.
            setErrorState(null);
        } else {
            setIsPending(true);

            promise.then(
                () => {
                    setIsPending(false);

                    // Clear the error state once submission completes. If the pending spinner
                    // didn't clear it earlier.
                    setErrorState(null);
                },
                error => {
                    setIsPending(false);
                    setErrorState({error});
                },
            );
        }
    });

    useImperativeHandle(
        ref,
        () => ({
            submit: handleSubmit,
        }),
        [handleSubmit],
    );

    return (
        <form
            onKeyDown={event => {
                switch (event.key) {
                    // Automatically submit the form when the user presses the enter key in an
                    // input. Most browsers do this automatically. We override the browser logic
                    // so we can show a pressed state on the button and make sure focus doesn't
                    // move from the input.
                    case "Enter": {
                        event.preventDefault();
                        event.stopPropagation();

                        if (!isDisabled) {
                            setIsButtonPressed(true);
                        }
                        break;
                    }
                }
            }}
            onKeyUp={event => {
                switch (event.key) {
                    // Automatically submit the form when the user presses the enter key in an
                    // input. Most browsers do this automatically. We override the browser logic
                    // so we can show a pressed state on the button and make sure focus doesn't
                    // move from the input.
                    case "Enter": {
                        event.preventDefault();
                        event.stopPropagation();

                        if (!isDisabled) {
                            setIsButtonPressed(false);
                            handleSubmit();
                        }
                        break;
                    }
                }
            }}
            onSubmit={event => {
                // Don't perform a page navigation. Instead we'll handle the submission on
                // the client.
                event.preventDefault();

                handleSubmit();
            }}
        >
            {children}
            {cloneElement(button, {
                shouldSubmitForm: true,
                isPressed: isButtonPressed,
                isPending,
                // Override when the button pending spinner should be shown with our own
                // loading indicator delay that's synchronized with error clearing.
                shouldShowPendingSpinner,
            })}
            {afterButton}
            {errorState && (
                <Box paddingTop={formErrorMarginTop}>
                    <ErrorDisplayMessageRenderer
                        fontSize={formErrorFontSize}
                        color="red-60"
                        error={errorState.error}
                        // Add punctuation to the title since it was written standalone.
                        prefixMessage={<>{submitErrorTitle}.</>}
                        isSingleLine={true}
                    />
                </Box>
            )}
        </form>
    );
}
