import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export type InlineEditorToolbarRef = {
    save(): void;
};

const InlineEditorToolbarForwardRef = forwardRef(InlineEditorToolbar);
export {InlineEditorToolbarForwardRef as InlineEditorToolbar};

function InlineEditorToolbar(
    {
        placement = "bottom",
        isSaving: isSavingFromProps = false,
        withModEnterSaveKeyboardShortcut,
        saveErrorTitle,
        onSave,
        onCancel,
    }: {
        placement?: "top" | "bottom";
        isSaving?: boolean;
        withModEnterSaveKeyboardShortcut?: boolean;
        saveErrorTitle?: string;
        onSave: () => MaybePromise<void>;
        onCancel: () => void;
    },
    ref: Ref<InlineEditorToolbarRef>,
) {
    const {isAppleDevice} = useClientInfo();

    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [isSavingFromState, setIsSaving] = useState(false);

    const isSaving = isSavingFromProps || isSavingFromState;

    useImperativeHandle(
        ref,
        () => ({
            save: () => assertExists(saveButtonRef.current).press(),
        }),
        [],
    );

    return (
        <Box
            position="absolute"
            bottom={placement === "bottom" ? "-1.5" : undefined}
            top={placement === "bottom" ? undefined : "-1.5"}
            right="0"
            zIndex="10"
            display="flex"
            padding="1"
            gap="1"
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            style={{transform: placement === "bottom" ? "translateY(100%)" : "translateY(-100%)"}}
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
                ref={saveButtonRef}
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
                onPress={() => {
                    const result = onSave();

                    if (result instanceof Promise) {
                        setIsSaving(true);
                        return result.finally(() => setIsSaving(false));
                    }
                }}
            >
                Save
            </Button>
        </Box>
    );
}
