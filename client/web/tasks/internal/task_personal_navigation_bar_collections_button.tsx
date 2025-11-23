import {setInteractionModality} from "@react-aria/interactions";
import {CaretDown, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxState, useSingleSelectListState} from "react-stately";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {
    TaskCollectionComboBoxItem,
    renderTaskCollectionComboBoxItem,
} from "~/client/web/tasks/internal/task_collection_combo_box_item.js";
import {TaskCollectionComboBoxListBox} from "~/client/web/tasks/internal/task_collection_combo_box_list_box.js";
import {useTaskCollectionComboBoxSearchState} from "~/client/web/tasks/internal/task_collection_combo_box_search_state.js";
import {usePreloadSearchTaskCollectionsByAffinity} from "~/client/web/tasks/internal/use_search_task_collections_by_affinity.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";

export function TaskPersonalNavigationBarCollectionsButton({store}: {store: TaskClientStore}) {
    // Preload task collections the account has an affinity for in case they open
    // the collections dropdown.
    usePreloadSearchTaskCollectionsByAffinity();

    return (
        <OverlayTriggerButton
            aria-haspopup="listbox"
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    className={greyElevated2ClassName}
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="1.5"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskPersonalNavigationBarCollectionsComboBoxOverlay
                        store={store}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </Box>
            )}
        >
            <Button
                variant="quieter"
                height="6"
                paddingX="2"
                icon={<CaretDown />}
                iconPlacement="end"
                // Don't focus the button on press since pressing will open the overlay and
                // should focus the overlay.
                //
                // TODO(calebmer): Find a way to automate this instead of setting this prop
                // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                withoutFocusOnPress={true}
            >
                My collections
            </Button>
        </OverlayTriggerButton>
    );
}

function TaskPersonalNavigationBarCollectionsComboBoxOverlay({
    store,
    onCloseWithoutAnimation,
}: {
    store: TaskClientStore;
    onCloseWithoutAnimation: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const reporter = useReporter();
    const context = useAppContext();
    const {space} = useSpaceContext();

    const [inputValue, setInputValue] = useState("");

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
        store,
        inputValue,
        // The overlay is always open in this component. We always want to load
        // collection data.
        shouldLoadItems: true,
    });

    const [pendingKey, setPendingKey] = useState<TaskCollectionComboBoxItem["key"] | null>(null);

    const {collection, selectionManager, disabledKeys} = useSingleSelectListState({
        items: items ?? emptyArray,
        children: renderTaskCollectionComboBoxItem,

        selectedKey: null,
        onSelectionChange: key => {
            if (!key) return;

            assert(typeof key === "string");

            if (key.startsWith("Collection:")) {
                const collectionId = key.slice("Collection:".length);
                assert(isId<TaskCollectionId>(collectionId));

                setPendingKey(`Collection:${collectionId}`);

                // Don't open in a peek.
                rootNavigate(`/s/${space.id}/tasks/collections/${collectionId}`).then(
                    () => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== `Collection:${collectionId}`) return pendingKey;
                            return null;
                        });

                        onCloseWithoutAnimation();
                    },
                    error => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== `Collection:${collectionId}`) return pendingKey;
                            return null;
                        });

                        reporter.displayError("Couldn’t open collection", error);
                    },
                );

                // Navigating to a collection from this list is a strong positive signal that
                // this is an entity the user cares about. Apply the same point increase as
                // when the user navigates to an entity from search.
                markSearchAffinityEntityInteraction(context, {
                    spaceId: space.id,
                    entityId: `TaskCollection:${collectionId}`,
                    interaction: {type: "HighIntentUpdate"},
                }).catch(error => {
                    // Silently fail. This doesn't affect anything the user sees so we don't need
                    // to report the error to the user.
                    reporter.logErrorWithoutDisplaying(
                        "Couldn’t mark collection result select affinity interaction",
                        error,
                    );
                });
            } else {
                assert(key === "CreateCollection");

                setPendingKey("CreateCollection");

                // Don't open in a peek.
                rootNavigate(
                    `/s/${space.id}/tasks/collections/${generateId()}?create${
                        inputValue.length > 0 ? `=${encodeURIComponent(inputValue)}` : ""
                    }`,
                ).then(
                    () => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== "CreateCollection") return pendingKey;
                            return null;
                        });

                        onCloseWithoutAnimation();
                    },
                    error => {
                        setPendingKey(pendingKey => {
                            if (pendingKey !== "CreateCollection") return pendingKey;
                            return null;
                        });

                        reporter.displayError("Couldn’t create collection", error);
                    },
                );
            }
        },
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<TaskCollectionComboBoxItem> = {
        inputValue,
        setInputValue,

        commit: () => {
            selectionManager.select(selectionManager.focusedKey);
        },
        revert: () => {
            setInputValue("");
            onCloseWithoutAnimation();
        },

        // Always open
        isOpen: true,
        setOpen: noop,
        open: noop,
        close: noop,
        toggle: noop,
        focusStrategy: "first",

        isFocused: selectionManager.isFocused,
        setFocused: isFocused => selectionManager.setFocused(isFocused),

        // We use multiple selection, there is never one selected key.
        selectedKey: null as any,
        selectedItem: null as any,
        setSelectedKey: key => selectionManager.select(key as any),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": "Collection",
            inputRef,
            popoverRef,
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: items ?? emptyArray,
            onKeyDown: event => {
                switch (event.key) {
                    case "ArrowDown":
                    case "ArrowUp":
                    case "Home":
                    case "End": {
                        setInteractionModality("keyboard");
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    return (
        <>
            <Box position="relative">
                <Box position="absolute" top="3" left="2.5" pointerEvents="none" color="grey-70">
                    <MagnifyingGlass size={spacing["3"]} />
                </Box>
                <FocusRing offset="border">
                    <input
                        {...inputProps}
                        ref={inputRef}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "block",
                            width: "full",
                            height: "9",
                            paddingLeft: "7",
                            paddingRight: shouldShowSearchLoadingIndicator ? "7" : "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "1.5",
                            borderBottomRadius: "none",
                        })}
                        style={{boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5-translucent"]}`}}
                        placeholder="Search all collections"
                        onKeyDown={event => {
                            // Don't handle a tab keypress with `react-aria`. Instead let our
                            // `<OverlayTriggerButton>` handle it.
                            if (event.key === "Tab") return;

                            if (
                                event.key === "Enter" &&
                                comboBoxState.selectionManager.focusedKey == null
                            ) {
                                // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                // option isn't focused this just closes the combobox and leaves the user
                                // confused. Is what they typed the new value or not? It's not, you can tell
                                // since the avatar doesn't change. This is particularly confusing on mobile
                                // where the user may hit the return key expecting the first value in the menu
                                // to be selected. But that won't happen, the menu will just close.
                                //
                                // So intercept this case and don't call into `@react-aria/combobox`.
                                //
                                // [1]: https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132
                            } else {
                                inputProps.onKeyDown?.(event);
                            }
                        }}
                    />
                </FocusRing>
                {shouldShowSearchLoadingIndicator && (
                    <Box
                        position="absolute"
                        top="3"
                        right="2.5"
                        pointerEvents="none"
                        color="grey-70"
                    >
                        <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                    </Box>
                )}
            </Box>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                <TaskCollectionComboBoxListBox
                    comboBoxState={comboBoxState}
                    listBoxRef={listBoxRef}
                    listBoxProps={listBoxProps}
                    pendingKey={pendingKey}
                    autoFocus={false}
                    shouldHideNoResultsIcon={true}
                />
            </Box>
        </>
    );
}
