import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useInputWithAutoGrowingWidthSafeSpacerElement} from "~/client/web/design/use_input_with_auto_growing_width_safe_spacer_element.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {defaultTaskQueryViewName} from "~/client/web/styles/tasks_shared_styles.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type TaskQueryViewDesktopHeaderNameRef = {
    editName(): void;
};

const TaskQueryViewDesktopHeaderNameForwardRef = forwardRef(TaskQueryViewDesktopHeaderName);
export {TaskQueryViewDesktopHeaderNameForwardRef as TaskQueryViewDesktopHeaderName};

function TaskQueryViewDesktopHeaderName(
    {
        name,
        onNameChange,
    }: {
        name: string;
        onNameChange: (name: string) => void;
    },
    ref: Ref<TaskQueryViewDesktopHeaderNameRef>,
) {
    const [isEditingName, setIsEditingName] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            editName: () => setIsEditingName(true),
        }),
        [setIsEditingName],
    );

    const inputWithAutoGrowingWidthSafeSpacerElement =
        useInputWithAutoGrowingWidthSafeSpacerElement();

    const lastPointerDownTimeRef = useRef<number | null>(null);

    return (
        <Box overflow="hidden" marginLeft="-1">
            {!isEditingName ? (
                <Box
                    padding="1"
                    fontSize="200"
                    fontStyle="truncate-semi-bold"
                    userSelect="text"
                    style={{
                        // Render contextual alternate glyphs. User text may be rendered here. Helpful
                        // for consistency if the user types anything like 2x2 or an @ mention.
                        // eslint-disable-next-line cyberworlds/string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                    onPointerDown={event => {
                        const currentTime = Date.now();
                        const lastPointerDownTime = lastPointerDownTimeRef.current;
                        lastPointerDownTimeRef.current = currentTime;

                        if (lastPointerDownTime === null) return;

                        if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;

                        // Disable selection from double click.
                        //
                        // We implement double click with `onPointerDown` instead of `onDoubleClick`
                        // because `onDoubleClick` fires one pointer up but the browser performs text
                        // selection on double click pointer down. So there's a small visual glitch
                        // where you can see the browser selection after double click before pointer up
                        // when you use `onDoubleClick`,
                        event.preventDefault();

                        setIsEditingName(true);
                    }}
                >
                    {name}
                    {inputWithAutoGrowingWidthSafeSpacerElement}
                </Box>
            ) : (
                <Box overflow="hidden">
                    <TaskQueryViewDesktopHeaderNameEditor
                        initialName={name}
                        onCancel={() => {
                            setIsEditingName(false);
                        }}
                        onSave={name => {
                            // If you try to save an empty name, it cancels editing.
                            if (name.length === 0) {
                                setIsEditingName(false);
                                return;
                            }

                            setIsEditingName(false);
                            onNameChange(name);
                        }}
                    />
                </Box>
            )}
        </Box>
    );
}

function TaskQueryViewDesktopHeaderNameEditor({
    initialName,
    onCancel,
    onSave,
}: {
    initialName: string;
    onCancel: () => void;
    onSave: (name: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.select();
        inputElement.focus({preventScroll: true});
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box maxWidth="full" height="8">
                <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                    <InputWithAutoGrowingWidth
                        ref={useMergedRefs(
                            inputRef,
                            useConfirmSaveAfterLosingFocus({
                                shouldConfirmSave: name.length > 0 && name !== initialName,
                                isConfirmingSave: shouldShowConfirmSaveDialog,
                                onCancelSave: () => void onCancel(),
                                onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                            }),
                        )}
                        placeholder={
                            initialName.length > 0 ? initialName : defaultTaskQueryViewName
                        }
                        autoComplete="false"
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        className={sprinkles({
                            paddingY: "1",
                            borderRadius: "1",
                        })}
                        style={{
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                        textClassName={sprinkles({
                            fontSize: "200",
                            fontStyle: "semi-bold",
                            paddingX: "1",
                        })}
                        textStyle={{
                            // Render contextual alternate glyphs. User text may be rendered here. Helpful
                            // for consistency if the user types anything like 2x2 or an @ mention.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSave(name);
                                    break;
                                }
                                case "Escape": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCancel();
                                    break;
                                }
                            }
                        }}
                    />
                </FocusRing>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save view name"
                    description="Would you like to save your new view name?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save name"
                    onPrimaryButtonPress={() => onSave(name)}
                    cancelButtonLabel="Discard name"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard name"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
