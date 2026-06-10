import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {newChannelNamePlaceholder} from "~/client/web/forum/new_channel_name_placeholder.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function ChannelViewNameEditor({
    shouldInitiallyFocusChannelName = true,
    initialName,
    onCancel,
    onSave,
}: {
    shouldInitiallyFocusChannelName?: boolean;
    initialName: string;
    onCancel: () => MaybePromise<void>;
    onSave: (name: string) => Promise<void>;
}) {
    const reporter = useReporter();

    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [isSaving, setIsSaving] = useState(false);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldShowSavingIndicator = useDelayLoadingIndicator(isSaving);

    const shouldFocusNextRenderRef = useRef(shouldInitiallyFocusChannelName);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        return scheduleAfterNavigationAnimation(() => {
            const inputElement = assertExists(inputRef.current);
            inputElement.select();
            inputElement.focus({preventScroll: true});
        });
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box minWidth="flex-fit" marginLeft="-1">
                <Box display="flex" alignItems="center" gap="2" maxWidth="full" height="9">
                    <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                        <InputWithAutoGrowingWidth
                            maxLength={maxLabelStringLength}
                            ref={useMergedRefs(
                                inputRef,
                                useConfirmSaveAfterLosingFocus({
                                    // It's ok to unfocus while creating a channel and nothing has been input. This
                                    // will happen when you create a channel, a peek opens, then you immediately close
                                    // the peek.
                                    //
                                    // We won't auto-focus this input when create a channel through search.
                                    isDisabled: name.length === 0,

                                    shouldConfirmSave:
                                        // If the initial name is empty, we are creating an optimistic collection and you
                                        // must provide a name.
                                        initialName.length === 0 ||
                                        // Otherwise if you delete all of the collection name it will revert back to the
                                        // initial name.
                                        (name.length > 0 && name !== initialName),
                                    isConfirmingSave: shouldShowConfirmSaveDialog,
                                    onCancelSave: () => void onCancel(),
                                    onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                                }),
                            )}
                            placeholder={
                                initialName.length > 0 ? initialName : newChannelNamePlaceholder
                            }
                            autoComplete="false"
                            value={name}
                            onChange={event => {
                                if (isSaving) return;
                                setName(event.currentTarget.value);
                            }}
                            className={sprinkles({
                                paddingY: "1",
                                borderRadius: "1",
                            })}
                            style={{
                                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                            }}
                            textClassName={sprinkles({
                                paddingX: "1",
                                fontSize: "400",
                                fontStyle: "bold",
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

                                        if (isSaving) break;

                                        runPromiseWithoutAwaiting(async () => {
                                            setIsSaving(true);
                                            try {
                                                await onSave(name);
                                            } catch (error) {
                                                reporter.displayError(
                                                    "Couldn\u2019t save name",
                                                    error,
                                                );
                                            } finally {
                                                setIsSaving(false);
                                            }
                                        });
                                        break;
                                    }
                                    case "Escape": {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (isSaving) break;

                                        void onCancel();
                                        break;
                                    }
                                }
                            }}
                        />
                    </FocusRing>
                    {shouldShowSavingIndicator && (
                        <SpinnerGap
                            className={classNames(
                                spinAnimationClassName,
                                sprinkles({flexShrink: "0"}),
                            )}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["4"]}
                        />
                    )}
                </Box>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save channel name"
                    description="Would you like to save your new channel name?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel" and
                        // lets the user continue writing.
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
