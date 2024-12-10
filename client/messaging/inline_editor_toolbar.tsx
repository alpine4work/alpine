import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function InlineEditorToolbar({
    isSaving,
    withModEnterSaveKeyboardShortcut,
    saveErrorTitle,
    onSave,
    onCancel,
}: {
    isSaving: boolean;
    withModEnterSaveKeyboardShortcut?: boolean;
    saveErrorTitle?: string;
    onSave: () => MaybePromise<void>;
    onCancel: () => void;
}) {
    const {isAppleDevice} = useClientInfo();

    return (
        <Box
            position="absolute"
            bottom="-1.5"
            right="0"
            zIndex="10"
            display="flex"
            padding="1"
            gap="1"
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            style={{transform: "translateY(100%)"}}
        >
            <Button
                variant="quiet"
                isFocusable={false}
                withoutMinWidth={true}
                fontSize="50"
                height="6"
                paddingX="2"
                borderRadius="1"
                keyboardShortcutHint="Esc"
                keyboardShortcutHintTooltipOffset="2.5"
                isDisabled={isSaving}
                onPress={onCancel}
            >
                Cancel
            </Button>
            <Button
                variant="neutral"
                isFocusable={false}
                withoutMinWidth={true}
                fontSize="50"
                height="6"
                // Intentionally larger `paddingX` than "Cancel" button.
                paddingX="3"
                borderRadius="1"
                keyboardShortcutHint={
                    withModEnterSaveKeyboardShortcut
                        ? `${isAppleDevice ? "⌘" : "Ctrl"}+Enter`
                        : "Enter"
                }
                keyboardShortcutHintTooltipOffset="2.5"
                isPending={isSaving}
                pressErrorTitle={saveErrorTitle}
                onPress={onSave}
            >
                Save
            </Button>
        </Box>
    );
}
