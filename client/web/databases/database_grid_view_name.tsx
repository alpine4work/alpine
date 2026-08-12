import {useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/web/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useInputWithAutoGrowingWidthSafeSpacerElement} from "~/client/web/design/use_input_with_auto_growing_width_safe_spacer_element.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    type ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {updateDatabaseTableName} from "~/shared/rpc/database_tables_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function DatabaseGridViewName({
    tableId,
    name,
    accessPolicy,
}: {
    tableId: DatabaseTableId;
    name: string;
    accessPolicy: ResolvedAccessPolicyWithGenerations;
}) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const [isEditing, setIsEditing] = useState(false);
    const lastPointerDownTimeRef = useRef<number | null>(null);
    const safeSpacerElement = useInputWithAutoGrowingWidthSafeSpacerElement();
    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    if (isEditing) {
        return (
            <DatabaseGridViewNameEditor
                initialName={name}
                onCancel={() => setIsEditing(false)}
                onSave={async newName => {
                    await updateDatabaseTableName(context, {tableId, name: newName});
                    setIsEditing(false);
                }}
            />
        );
    }

    return (
        <h1
            className={sprinkles({
                margin: "0",
                paddingY: "1",
                paddingX: "1",
                fontSize: "200",
                fontStyle: "truncate-semi-bold",
                userSelect: "text",
            })}
            style={{
                // eslint-disable-next-line cyberworlds/string-quotes
                fontFeatureSettings: '"calt" on',
            }}
            onPointerDown={event => {
                const currentTime = Date.now();
                const lastPointerDownTime = lastPointerDownTimeRef.current;
                lastPointerDownTimeRef.current = currentTime;
                if (lastPointerDownTime === null) return;
                if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;
                if (!hasAccessLevel(accessLevel, "Manage")) return;

                event.preventDefault();
                setIsEditing(true);
            }}
        >
            {name}
            {safeSpacerElement}
        </h1>
    );
}

function DatabaseGridViewNameEditor({
    initialName,
    onCancel,
    onSave,
}: {
    initialName: string;
    onCancel: () => void;
    onSave: (name: string) => Promise<void>;
}) {
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);
    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldShowConfirmSaveDialog || !shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;
        return scheduleAfterNavigationAnimation(() => {
            const input = assertExists(inputRef.current);
            input.select();
            input.focus({preventScroll: true});
        });
    }, [shouldShowConfirmSaveDialog]);

    function saveName(): Promise<void> | undefined {
        if (name.length === 0) {
            onCancel();
            return;
        }
        return onSave(name);
    }

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
                                onCancelSave: onCancel,
                                onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                            }),
                        )}
                        maxLength={maxLabelStringLength}
                        aria-label="Database name"
                        placeholder={initialName}
                        autoComplete="false"
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        className={sprinkles({paddingY: "1", borderRadius: "1"})}
                        style={{boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`}}
                        textClassName={sprinkles({
                            fontSize: "200",
                            fontStyle: "semi-bold",
                            paddingX: "1",
                        })}
                        textStyle={{
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter":
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const savingPromise = saveName();
                                    if (savingPromise) {
                                        addGlobalLoadingIndicator(savingPromise, {type: "Saving"});
                                    }
                                    break;
                                case "Escape":
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCancel();
                                    break;
                            }
                        }}
                    />
                </FocusRing>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save database name"
                    description="Would you like to save your new database name?"
                    onClose={() => {
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save name"
                    onPrimaryButtonPress={saveName}
                    cancelButtonLabel="Discard name"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard name"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
