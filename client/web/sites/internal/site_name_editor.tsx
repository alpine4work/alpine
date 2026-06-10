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
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Inline editor for a site's name. Mirrors `ChannelViewNameEditor` — Enter commits
 * the rename, Escape cancels, and losing focus with unsaved changes pops a confirm
 * dialog so the user can save or discard.
 */
export function SiteNameEditor({
    shouldInitiallyFocusSiteName = true,
    initialName,
    onCancel,
    onSave,
}: {
    shouldInitiallyFocusSiteName?: boolean;
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

    const shouldFocusNextRenderRef = useRef(shouldInitiallyFocusSiteName);

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
            <Box minWidth="flex-fit">
                <Box display="flex" alignItems="center" gap="2" maxWidth="full" height="9">
                    <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                        <InputWithAutoGrowingWidth
                            maxLength={maxLabelStringLength}
                            ref={useMergedRefs(
                                inputRef,
                                useConfirmSaveAfterLosingFocus({
                                    // Empty input means there's nothing to save — let losing focus quietly cancel.
                                    isDisabled: name.length === 0,

                                    shouldConfirmSave:
                                        // If the initial name is empty (newly-created site) the user must commit a name
                                        // before leaving.
                                        initialName.length === 0 ||
                                        // Otherwise only confirm when the name actually changed.
                                        (name.length > 0 && name !== initialName),
                                    isConfirmingSave: shouldShowConfirmSaveDialog,
                                    onCancelSave: () => void onCancel(),
                                    onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                                }),
                            )}
                            placeholder={initialName.length > 0 ? initialName : "New site"}
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
                    title="Save site name"
                    description="Would you like to save your new site name?"
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
