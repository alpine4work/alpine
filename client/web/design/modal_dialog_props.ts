import {AppContext} from "~/client/web/context/app_context.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * Props for a `<ModalDialog>` component.
 */
// In a separate file from `modal_dialog.tsx` to prevent cyclic imports between
// `modal_dialog.tsx` and `reporter.tsx`. Cyclic imports degrade the HMR developer
// experience since more files need to be re-evaluated on every change.
export type ModalDialogProps = {
    readonly title: string;
    readonly description:
        | string
        | {readonly type: "Error"; readonly error: unknown; readonly reportingContext?: AppContext};
    readonly "data-ownedby"?: string;
    readonly withTextInput?: boolean;
    readonly textInputPlaceholder?: string;
    readonly primaryButtonLabel: string;
    readonly primaryButtonVariant?: "accent" | "quiet";
    readonly isPrimaryButtonDisabled?: boolean;
    readonly primaryButtonPressErrorTitle?: string;
    readonly onPrimaryButtonPress?: (textInputValue: string) => MaybePromise<void>;
    readonly cancelButtonLabel?: string;
    readonly cancelButtonPressErrorTitle?: string;
    readonly onCancelButtonPress?: () => MaybePromise<void>;
    readonly shouldHideCancelButton?: boolean;
    readonly onClose: () => void;
    readonly withoutCloseInteractions?: boolean;
    readonly initiallyFocus?: "Primary" | "Cancel";
};
