// TODO(#sites): This whole component needs to be revisited. Like we proabbly only
// want to search for entities that are valid site entities and we also may want to
// filter out entities that are part of another site. There are also a whole bunch
// of hard-coded pixel dimensions and other styling that should be moved to the
// design system.
import {isFocusVisible, setInteractionModality} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {MagnifyingGlass, SpinnerGap, X} from "phosphor-react";
import {ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, Item, ListState, useListState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {getSearchEntityIcon} from "~/client/web/search/core/get_search_entity_icon.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSearchState} from "~/client/web/search/use_search_state.js";
import {useSiteMutations} from "~/client/web/sites/internal/use_site_mutations.js";
import {spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {
    SiteItemSearchEntityId,
    isSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntrySearchEntityModelData,
    isSiteEntrySearchEntityModelData,
} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Modal that searches existing entities and adds the selected ones to the site as
 * a batch. Selected entities render as chips above the input; the listbox filters
 * live as the user types, with checkmarks reflecting selection. "Add" commits the
 * batch sequentially with chained order keys derived from `getNextOrderKey`.
 */
export function AddExistingEntityToSiteModal({
    parentId,
    getNextOrderKey,
    onClose,
}: {
    parentId: SiteContainerId;
    getNextOrderKey: (previousOrderKey: OrderKey | null) => OrderKey;
    onClose: () => void;
}) {
    const {addMultipleEntities} = useSiteMutations();

    const [selectedEntities, setSelectedEntities] = useState<
        ReadonlyMap<SiteItemSearchEntityId, SiteEntrySearchEntityModelData>
    >(() => new Map());
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = useCallback(async () => {
        if (selectedEntities.size === 0) return;

        setIsAdding(true);
        let previousOrderKey: OrderKey | null = null;

        const entityInputs: Array<{
            entityId: SiteItemSearchEntityId;
            orderKey: OrderKey;
            parentId: SiteContainerId;
        }> = [];

        for (const entityId of selectedEntities.keys()) {
            const orderKey = getNextOrderKey(previousOrderKey);
            entityInputs.push({entityId, orderKey, parentId});
            previousOrderKey = orderKey;
        }

        await addMultipleEntities(entityInputs);

        setIsAdding(false);

        // TODO(#sites): Handle errors

        // Always close after a batch attempt — succeeded items are committed, and failures
        // have been surfaced to the user. Reopening to retry is one click.
        onClose();
    }, [addMultipleEntities, getNextOrderKey, onClose, parentId, selectedEntities]);

    return (
        <Box
            position="fixed"
            inset="0"
            display="flex"
            alignItems="flex-start"
            justifyContent="center"
            paddingTop="20"
            style={{backgroundColor: "rgba(0, 0, 0, 0.3)", zIndex: 1000}}
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <Box
                display="flex"
                flexDirection="column"
                backgroundColor="grey-0"
                borderRadius="3"
                style={{
                    width: 520,
                    maxHeight: 560,
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
                }}
            >
                <AddExistingEntityToSiteModalBody
                    selectedEntities={selectedEntities}
                    onSelectedEntitiesChange={setSelectedEntities}
                    onClose={onClose}
                    onAdd={handleAdd}
                    isAdding={isAdding}
                />
            </Box>
        </Box>
    );
}

function AddExistingEntityToSiteModalBody({
    selectedEntities,
    onSelectedEntitiesChange,
    onClose,
    onAdd,
    isAdding,
}: {
    selectedEntities: ReadonlyMap<SiteItemSearchEntityId, SiteEntrySearchEntityModelData>;
    onSelectedEntitiesChange: (
        next: ReadonlyMap<SiteItemSearchEntityId, SiteEntrySearchEntityModelData>,
    ) => void;
    onClose: () => void;
    onAdd: () => Promise<void>;
    isAdding: boolean;
}) {
    const {output, queryText, onQueryTextChange} = useSearchState({
        isSearchParamControlled: false,
        debugOptions: null,
    });
    const searchEntityRegistry = useSearchEntityRegistry();

    const searchedEntities = useMemo((): ReadonlyMap<
        SiteItemSearchEntityId,
        SiteEntrySearchEntityModelData
    > => {
        if (output.isError || output.results === null) return emptyMap;

        // Mirror the empty-query design from the original modal: don't show affinity
        // results before the user types, since this modal is purely a search affordance.
        const merged = output.type === "EmptyQuery" ? [] : output.results;

        return new Map(
            filterMapArray(merged, (result: SearchEntityResultModel) => {
                if (!isSiteItemSearchEntityId(result.id)) return undefined;
                if (result.model instanceof AccountModel) return undefined;

                const entityData = searchEntityRegistry.getEntityStore(result.model).getSnapshot();
                assert(isSiteEntrySearchEntityModelData(entityData));

                return [result.id, entityData];
            }),
        );
    }, [output, searchEntityRegistry]);

    // Show a search-in-progress spinner only when we have a non-empty query whose
    // results are still loading. `output.results === null` is the "loading" signal.
    const isSearchPending =
        queryText.trim().length > 0 && !output.isError && output.results === null;

    const renderItem = useCallback(
        (entity: SiteEntrySearchEntityModelData) => (
            <Item textValue={entity.title ?? "Untitled"}>
                <SearchResultRow entity={entity} />
            </Item>
        ),
        [],
    );

    const selectedKeys = useMemo(() => new Set(selectedEntities.keys()), [selectedEntities]);

    const {collection, selectionManager, disabledKeys} = useListState({
        items: mapIterable(searchedEntities, ([id, entity]) => ({...entity, key: id})),
        children: renderItem,
        selectionMode: "multiple",
        selectedKeys,
        onSelectionChange: keys => {
            if (keys === "all") return;

            const nextKeys = keys as Set<SiteItemSearchEntityId>;

            // Build the next selection map: keep already-selected entities the user didn't
            // deselect (these may not be in the current `searchedEntities` if their query no
            // longer matches), then add any newly-selected entities from the current results.
            const next = new Map<SiteItemSearchEntityId, SiteEntrySearchEntityModelData>();
            for (const [id, entity] of selectedEntities) {
                if (nextKeys.has(id)) next.set(id, entity);
            }
            for (const [id, entity] of searchedEntities) {
                if (nextKeys.has(id) && !next.has(id)) {
                    next.set(id, entity);
                }
            }
            onSelectedEntitiesChange(next);
        },
    });

    const listState = useMemo(
        (): ListState<SiteEntrySearchEntityModelData> => ({
            collection,
            disabledKeys,
            selectionManager,
        }),
        [collection, disabledKeys, selectionManager],
    );

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const comboBoxState: ComboBoxState<SiteEntrySearchEntityModelData> = {
        inputValue: queryText,
        setInputValue: onQueryTextChange,

        commit: () => {
            selectionManager.select(selectionManager.focusedKey);
        },
        revert: () => {
            onQueryTextChange("");
        },

        // Always open — the listbox is part of the modal layout.
        isOpen: true,
        setOpen: noop,
        open: noop,
        close: noop,
        toggle: noop,
        focusStrategy: "first",

        isFocused: selectionManager.isFocused,
        setFocused: isFocused => selectionManager.setFocused(isFocused),

        // Multi-select mode means there's never a single selectedKey.
        selectedKey: null as never,
        selectedItem: null as never,
        setSelectedKey: key => selectionManager.select(key!),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": "Search to add to site",
            // @ts-expect-error: NOTE(ifitzsimmons, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(ifitzsimmons, #react-v19-upgrade): see above.
            popoverRef,
            // @ts-expect-error: NOTE(ifitzsimmons, #react-v19-upgrade): see above.
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: searchedEntities.values(),
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

    const handleRemoveChip = useCallback(
        (id: SiteItemSearchEntityId) => {
            const next = new Map(selectedEntities);
            next.delete(id);
            onSelectedEntitiesChange(next);
        },
        [onSelectedEntitiesChange, selectedEntities],
    );

    return (
        <>
            {/* Header with chips + close */}
            <Box
                display="flex"
                alignItems="flex-start"
                gap="2"
                paddingX="3"
                paddingTop="3"
                paddingBottom="2"
            >
                <Box flexGrow="1" display="flex" flexWrap="wrap" gap="1">
                    <Box
                        fontSize="75"
                        fontStyle="semi-bold"
                        color="grey-40"
                        style={{width: "100%"}}
                    >
                        Add existing to site
                    </Box>
                    {Array.from(
                        mapIterable(selectedEntities, ([id, entity]) => (
                            <Chip key={id} entity={entity} onRemove={() => handleRemoveChip(id)} />
                        )),
                    )}
                </Box>
                <Button variant="quietest" fontSize="75" onPress={onClose}>
                    <X size={14} />
                </Button>
            </Box>

            {/* Search input */}
            <Box position="relative" paddingX="3" paddingBottom="2">
                <Box position="absolute" top="2.5" left="5" pointerEvents="none" color="grey-50">
                    <MagnifyingGlass size={16} />
                </Box>
                <FocusRing offset="border" isDisabled={!!selectionManager.focusedKey}>
                    <input
                        {...inputProps}
                        ref={inputRef}
                        className={sprinkles({
                            display: "block",
                            width: "full",
                            borderRadius: "2",
                            border: "none",
                        })}
                        style={{
                            height: 36,
                            paddingLeft: 32,
                            paddingRight: isSearchPending ? 32 : 12,
                            outline: "none",
                            fontSize: 14,
                        }}
                        placeholder="Search for a document, channel, task…"
                        autoCorrect={undefined}
                        spellCheck={undefined}
                        onKeyDown={event => {
                            if (event.key === "Escape") {
                                event.stopPropagation();
                                onClose();
                                return;
                            }
                            if (
                                event.key === "Enter" &&
                                comboBoxState.selectionManager.focusedKey == null
                            ) {
                                // Don't let `react-aria` close/commit when no option is focused — we want Enter to
                                // be a no-op rather than a confusing dismiss.
                                return;
                            }
                            inputProps.onKeyDown?.(event);
                        }}
                    />
                </FocusRing>
                {isSearchPending && (
                    <Box position="absolute" top="2.5" right="5" pointerEvents="none">
                        <SpinnerGap className={spinAnimationClassName} size={16} />
                    </Box>
                )}
            </Box>

            {/* Divider */}
            <Box style={{height: 1, backgroundColor: "#e5e5e5"}} marginX="3" />

            {/* Results */}
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                style={{minHeight: 200}}
            >
                {output.isError ? (
                    <Placeholder>Couldn&#x2019;t load search results</Placeholder>
                ) : queryText.trim().length === 0 ? (
                    <Placeholder>Type to search for an existing entity</Placeholder>
                ) : output.results === null ? (
                    <Placeholder>Searching…</Placeholder>
                ) : searchedEntities.size === 0 ? (
                    <Placeholder>No results</Placeholder>
                ) : (
                    <SearchResultListBox
                        listState={listState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                    />
                )}
            </Box>

            {/* Footer */}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="flex-end"
                gap="1.5"
                paddingX="3"
                paddingY="2"
                borderTop="grey-5"
            >
                <Button variant="quietest" onPress={onClose}>
                    Cancel
                </Button>
                <Button
                    isDisabled={selectedEntities.size === 0 || isAdding}
                    onPress={onAdd}
                    pressErrorTitle="Couldn&#x2019;t add to site"
                >
                    {isAdding
                        ? "Adding…"
                        : selectedEntities.size > 0
                          ? `Add ${selectedEntities.size}`
                          : "Add"}
                </Button>
            </Box>
        </>
    );
}

function Chip({entity, onRemove}: {entity: SiteEntrySearchEntityModelData; onRemove: () => void}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap="1"
            paddingX="1.5"
            paddingY="0.5"
            backgroundColor="grey-5"
            borderRadius="2"
            fontSize="75"
            style={{maxWidth: 200}}
        >
            <Box flexShrink="0" display="flex" alignItems="center">
                {getSearchEntityIcon(entity)}
            </Box>
            <Box
                style={{overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}
                flexGrow="1"
            >
                {entity.title ?? "Untitled"}
            </Box>
            <Button variant="quietest" fontSize="75" onPress={onRemove}>
                <X size={12} />
            </Button>
        </Box>
    );
}

function SearchResultRow({entity}: {entity: SiteEntrySearchEntityModelData}) {
    return (
        <Box display="flex" alignItems="center" gap="2" flexGrow="1">
            <Box flexShrink="0">{getSearchEntityIcon(entity)}</Box>
            <Box
                flexGrow="1"
                fontSize="100"
                style={{overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}
            >
                {entity.title ?? "Untitled"}
            </Box>
            <Box fontSize="75" color="grey-40" flexShrink="0">
                {entity.type}
            </Box>
        </Box>
    );
}

function SearchResultListBox({
    listState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    listState: ListState<SiteEntrySearchEntityModelData>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<SiteEntrySearchEntityModelData>;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox(
        {
            ..._listBoxProps,
            autoFocus: false,
            // @ts-expect-error: NOTE(ifitzsimmons, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        listState,
        listBoxRef,
    );

    return (
        <div
            ref={useMergedRefs(useScrollbar(), scrollRef)}
            className={sprinkles({
                position: "relative",
                flexGrow: "1",
                paddingX: "1",
                paddingY: "1",
                overflowX: "hidden",
                overflowY: "auto",
            })}
            style={{maxHeight: 320}}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
                {Array.from(listState.collection, item => (
                    <SearchResultListBoxOption key={item.key} listState={listState} item={item} />
                ))}
            </ul>
        </div>
    );
}

function SearchResultListBoxOption({
    listState,
    item,
}: {
    listState: ListState<SiteEntrySearchEntityModelData>;
    item: Node<SiteEntrySearchEntityModelData>;
}) {
    const optionRef = useRef(null);
    const {optionProps, isFocused, isPressed, isSelected, isHovered} = useOption(
        {key: item.key, disallowsDifferentPressOrigin: true},
        listState,
        // @ts-expect-error: NOTE(ifitzsimmons, #react-v19-upgrade): see above.
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    return (
        <FocusRing offset="inset" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...optionProps}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    paddingX: "2",
                    paddingY: "1.5",
                    borderRadius: "1",
                    color: "grey-100",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: "1.5",
                })}
            >
                <Box flexShrink="0" display="flex" alignItems="center">
                    <CheckboxIcon isChecked={isSelected} />
                </Box>
                {item.rendered}
            </li>
        </FocusRing>
    );
}

function Placeholder({children}: {children: ReactNode}) {
    return (
        <Box paddingX="3" paddingY="3" fontSize="100" color="grey-40" textAlign="center">
            {children}
        </Box>
    );
}
