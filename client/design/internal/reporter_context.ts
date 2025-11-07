import {Memo, ReactNode, createContext} from "react";
import {AppContext} from "~/client/context/app_context.js";
import {ModalDialogProps} from "~/client/design/modal_dialog_props.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";

export type ReporterModalDialogProps = Omit<ModalDialogProps, "onClose"> & {
    readonly key?: unknown;
    readonly onAfterClose?: () => void;
};

/**
 * The reporter abstraction is used for conveniently reporting some message to
 * the user from anywhere in the product. Primarily, it's used for reporting
 * errors to the user which will use a different design depending on the
 * platform.
 *
 * You may also use the reporter object to show a dialog from anywhere as
 * opposed to rendering a `<ModalDialog>` yourself. In the future you may also
 * use the reporter to show a non-error toast on desktop platforms (though not
 * on mobile).
 */
export type Reporter = Memo<{
    /**
     * Present a dialog using the `<ModalDialog>` component. You may call this as
     * an alternative to rendering a `<ModalDialog>` component yourself if you're
     * in a position where doing so may be complicated.
     */
    showDialog(dialogProps: ReporterModalDialogProps): void;

    /**
     * Are we showing a dialog with the provided key? Returns true if we have an
     * active dialog with the provided key or if we have a dialog queued with the
     * provided key.
     */
    hasDialogWithKey(key: unknown): boolean;

    /**
     * Display an error to the user.
     *
     * `title` should describe what happened in plain English for the user. Follow
     * the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * `title` should not include ending punctuation. Ending punctuation will be
     * added for you.
     *
     * `error` is the actual error object. If the error contains a `displayMessage`
     * then we'll show that to the user. Otherwise we'll show an "unknown error
     * ocurred" kind of message.
     *
     * On desktop the error is displayed as a toast which is minimally disruptive
     * to the user's experience. On mobile the error is displayed in a blocking
     * modal.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors/#What-happened
     */
    displayError(title: string, error: unknown): void;

    /**
     * Send an error to our logging provider without displaying it to the user.
     * If the error isn't noticeable to the user you should use this to avoid
     * disrupting their experience.
     */
    logErrorWithoutDisplaying(title: string, error: unknown): void;

    /**
     * Show a toast with a short message to the user. Only works on desktop
     * platforms. The toast will disappear after a couple seconds.
     *
     * Useful if you need to provide further context about an action the user
     * just took.
     */
    showInfoToast(message: ReactNode, options?: {durationSeconds?: number}): void;
}>;

// A `ReporterWithoutContext` object needs to be provided an `AppContext` since
// it doesn't know itself the context in which its methods are called.
export type ReporterWithoutContext = {
    // Cache of `Reporter` objects by `AppContext`.
    readonly cache: DefaultWeakMap<AppContext, Reporter>;

    readonly showDialog: (context: AppContext, dialogProps: ReporterModalDialogProps) => void;
    readonly hasDialogWithKey: (key: unknown) => boolean;
    readonly displayError: (context: AppContext, title: string, error: unknown) => void;
    readonly logErrorWithoutDisplaying: (
        context: AppContext,
        title: string,
        error: unknown,
    ) => void;
    readonly showInfoToast: (
        context: AppContext,
        message: ReactNode,
        options?: {durationSeconds?: number},
    ) => void;
};

export const ReporterContext = createContext<ReporterWithoutContext | null>(null);
