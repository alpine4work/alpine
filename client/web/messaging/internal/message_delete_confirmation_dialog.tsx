import {ModalDialog} from "~/client/web/design/modal_dialog.js";

export function MessageDeleteConfirmationDialog({
    messageNoun,
    onClose,
    onDeleteMessage,
}: {
    messageNoun: string;
    onClose: () => void;
    onDeleteMessage: () => Promise<void>;
}) {
    return (
        <ModalDialog
            title={`Delete ${messageNoun}?`}
            description={`Everyone will still be able to see that you sent a ${messageNoun} and the time you sent it, but they will not be able to see what was in the ${messageNoun}.`}
            onClose={onClose}
            primaryButtonLabel="Delete"
            primaryButtonPressErrorTitle={`Couldn’t delete ${messageNoun}`}
            onPrimaryButtonPress={onDeleteMessage}
        />
    );
}
