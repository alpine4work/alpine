import {CaretDown, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {useComboBox} from "react-aria";
import {ComboBoxState, useSingleSelectListState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskCollectionComboBoxItem,
    TaskCollectionComboBoxListBox,
    renderTaskCollectionComboBoxItem,
    useTaskCollectionComboBoxSearchState,
} from "~/client/tasks/internal/task_collection_combo_box_base.js";
import {usePreloadAffinitiveTaskCollections} from "~/client/tasks/internal/use_affinitive_task_collections.js";
import {spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {generateId, isId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {greyElevated2ClassName, spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

export function TaskLayoutTopBarCollectionsButton({
    isCollectionsTabActive,
}: {
    isCollectionsTabActive: boolean;
}) {
    // Preload task collections the account has an affinity for in case they open
    // the collections dropdown.
    usePreloadAffinitiveTaskCollections();

    return (
        <OverlayTriggerButton
            aria-haspopup="listbox"
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    className={greyElevated2ClassName}
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="md"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskLayoutTopBarCollectionsComboBoxOverlay
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </Box>
            )}
        >
            <Button
                variant={isCollectionsTabActive ? "quiet-on" : "quieter"}
                height="6"
                paddingX="2"
                icon={<CaretDown />}
                iconPlacement="end"
            >
                Collections
            </Button>
        </OverlayTriggerButton>
    );
}

function TaskLayoutTopBarCollectionsComboBoxOverlay({
    onCloseWithoutAnimation,
}: {
    onCloseWithoutAnimation: () => void;
}) {
    const navigate = useNavigate();
    const showToast = useShowToast();
    const {space} = useSpaceContext();

    const [inputValue, setInputValue] = useState("");

    const {shouldShowSearchLoadingIndicator, items} = useTaskCollectionComboBoxSearchState({
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

                navigate(`/s/${space.id}/tasks/collections/${collectionId}`).then(
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

                        showToast({
                            type: "Error",
                            title: "Couldn’t open collection",
                            error,
                        });
                    },
                );
            } else {
                assert(key === "CreateCollection");

                setPendingKey("CreateCollection");

                navigate(
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

                        showToast({
                            type: "Error",
                            title: "Couldn’t create collection",
                            error,
                        });
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
        },
        comboBoxState,
    );

    return (
        <>
            <Box position="relative">
                <Box position="absolute" top="2.5" left="2.5" pointerEvents="none" color="grey-70">
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
                            height: "8",
                            paddingLeft: "7",
                            paddingRight: shouldShowSearchLoadingIndicator ? "7" : "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "md",
                            borderBottom: "grey-10",
                        })}
                        placeholder="Search all collections"
                        onKeyDown={event => {
                            // Don't handle a tab keypress with `react-aria`. Instead let our
                            // `<OverlayTriggerButton>` handle it.
                            if (event.key === "Tab") return;

                            inputProps.onKeyDown?.(event);
                        }}
                    />
                </FocusRing>
                {shouldShowSearchLoadingIndicator && (
                    <Box position="absolute" top="2.5" right="2.5" pointerEvents="none">
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
