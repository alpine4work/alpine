import {isFocusVisible} from "@react-aria/interactions";
import classNames from "classnames";
import {CaretLeft} from "phosphor-react";
import {type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useComboBox, useListBox, useOption} from "react-aria";
import {
    type ComboBoxState,
    type ComboBoxStateOptions,
    Item,
    type Node,
    useComboBoxState,
} from "react-stately";
import {DatabaseGridViewFieldCreationPageRef} from "~/client/web/databases/grid_view/database_grid_view_field_creation_page_ref.js";
import {DatabaseGridViewNewField} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Switch} from "~/client/web/design/switch.js";
import {textInputClassName} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {
    searchByAffinity,
    searchDatabaseTablesByKeywords,
} from "~/shared/rpc/search_rpc_definitions.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";

type DatabaseGridViewLinkedTable = {
    readonly id: DatabaseTableId;
    readonly humanName: string;
};

const emptyTables: ReadonlyArray<DatabaseGridViewLinkedTable> = [];
const databaseGridViewLinkedTableLimit = 30;

/**
 * The second page of the field creation popover, shown after picking "Linked
 * record": a search combobox for database tables (filter input + list) with the
 * cardinality toggle fixed at the bottom. The filter input is auto focused;
 * selecting a table commits the new relation field.
 */
export function DatabaseGridViewFieldCreationLinkedTablePage({
    ref,
    name,
    onCommit,
    onBack,
}: {
    ref: Ref<DatabaseGridViewFieldCreationPageRef>;
    name: string;
    onCommit: (newField: DatabaseGridViewNewField) => void;
    onBack: () => void;
}) {
    const [filterValue, setFilterValue] = useState("");
    const [cardinality, setCardinality] = useState<"One" | "Many">("Many");
    const {space} = useSpaceContext();

    const inputRef = useRef<HTMLInputElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);
    const listContainerRef = useRef<HTMLDivElement>(null);

    const trimmedFilterValue = filterValue.trim();
    const [currentlyLoadingFilterValue, setCurrentlyLoadingFilterValue] =
        useState(trimmedFilterValue);
    const affinitySearch = useLazyLoadRpc(searchByAffinity, {spaceId: space.id});
    const {isLoading: originalIsLoading, output: keywordSearchOutput} = useLazyLoadRpc(
        searchDatabaseTablesByKeywords,
        {
            spaceId: space.id,
            queryText: currentlyLoadingFilterValue,
            // Load more fallback tables for the empty query before affinity re-ranks them.
            limit:
                currentlyLoadingFilterValue.length === 0
                    ? databaseGridViewLinkedTableLimit * 5
                    : databaseGridViewLinkedTableLimit,
        },
        {keepPreviousData: true},
    );
    let isLoading = originalIsLoading;
    // Do not start a new RPC while the prior search is in progress. This prevents a
    // burst of concurrent requests while the account types.
    if (!isLoading && currentlyLoadingFilterValue !== trimmedFilterValue) {
        isLoading = true;
        setCurrentlyLoadingFilterValue(trimmedFilterValue);
    }
    const filteredTables = useMemo(() => {
        if (!keywordSearchOutput) return emptyTables;

        const affinityScoreByTableId = new Map<DatabaseTableId, number>();
        for (const result of [
            ...(affinitySearch.output?.favoriteResults ?? []),
            ...(affinitySearch.output?.results ?? []),
        ]) {
            if (!result.id.startsWith("DatabaseTable:")) continue;
            affinityScoreByTableId.set(
                result.id.slice("DatabaseTable:".length) as DatabaseTableId,
                result.score,
            );
        }

        const resultByTableId = new Map(
            keywordSearchOutput.results.map(result => [
                result.tableId,
                {
                    id: result.tableId,
                    humanName: result.humanName,
                    keywordScore: result.score,
                    affinityScore: affinityScoreByTableId.get(result.tableId),
                },
            ]),
        );

        const interpolation = standardSearchOptions.affinityToKeywordScoreInterpolation;
        const slope =
            (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
            (interpolation.point2.affinityScore - interpolation.point1.affinityScore);
        const intercept =
            interpolation.point2.keywordScore - slope * interpolation.point2.affinityScore;

        return Array.from(resultByTableId.values())
            .sort((table1, table2) => {
                if (keywordSearchOutput.input.queryText.length === 0) {
                    if (table1.affinityScore !== undefined && table2.affinityScore !== undefined) {
                        const scoreDifference = table2.affinityScore - table1.affinityScore;
                        if (scoreDifference !== 0) return scoreDifference;
                    } else if (table1.affinityScore !== undefined) {
                        return -1;
                    } else if (table2.affinityScore !== undefined) {
                        return 1;
                    }
                } else {
                    const score1 =
                        table1.keywordScore +
                        (table1.affinityScore === undefined
                            ? 0
                            : slope * table1.affinityScore + intercept);
                    const score2 =
                        table2.keywordScore +
                        (table2.affinityScore === undefined
                            ? 0
                            : slope * table2.affinityScore + intercept);
                    if (score1 !== score2) return score2 - score1;
                }

                return (
                    defaultCompareStrings(table1.humanName, table2.humanName) ||
                    defaultCompareStrings(table1.id, table2.id)
                );
            })
            .slice(0, databaseGridViewLinkedTableLimit);
    }, [affinitySearch.output, keywordSearchOutput]);

    const commitTable = useEvent((table: DatabaseGridViewLinkedTable) => {
        // An empty name defaults to the linked table's name. The symmetric field on the
        // target side is created by the server, so this side is always the source.
        onCommit({
            name: name.trim() || table.humanName,
            config: {
                type: "Relation",
                joinTableId: generateId<DatabaseTableId>(),
                side: "Source",
                cardinality,
                linkedTableId: table.id,
            },
        });
    });

    const comboBoxProps: ComboBoxStateOptions<DatabaseGridViewLinkedTable> = {
        items: filteredTables,
        children: renderDatabaseGridViewLinkedTableItem,
        inputValue: filterValue,
        onInputChange: setFilterValue,
        menuTrigger: "focus",
        // The list stays visible through loading and empty filter results.
        allowsEmptyCollection: true,
        // Selecting a table commits the field, so no key is ever displayed as selected.
        selectedKey: null,
        onSelectionChange: key => {
            if (typeof key !== "string") return;
            const table = filteredTables.find(table => table.id === key);
            if (table != null) commitTable(table);
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            "aria-label": "Filter tables",
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            // The list renders inline in the popover rather than in its own overlay, so
            // the "popover" is just the list's container.
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef: listContainerRef,
        },
        comboBoxState,
    );

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // The list is always visible (it renders inline rather than as a dropdown), so
    // keep the combobox in the open state.
    useEffect(() => {
        if (!comboBoxState.isOpen) comboBoxState.open(null, "manual");
    }, [comboBoxState, comboBoxState.isOpen]);

    // Keep a table highlighted so enter always has something to commit: focus the
    // first item initially and whenever filtering removes the focused item.
    const focusedKey = comboBoxState.selectionManager.focusedKey;
    useEffect(() => {
        if (focusedKey == null || comboBoxState.collection.getItem(focusedKey) == null) {
            comboBoxState.selectionManager.setFocusedKey(comboBoxState.collection.getFirstKey());
        }
    }, [comboBoxState, focusedKey, comboBoxState.collection]);

    const commitFocusedTable = useEvent(() => {
        const table = filteredTables.find(table => table.id === focusedKey) ?? filteredTables[0];
        if (table != null) commitTable(table);
    });

    useImperativeHandle(ref, () => ({
        // The combobox owns list navigation, so arrow keys on the field name input just
        // move focus into the filter input.
        onNameInputKeyDown(event) {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.focus();
        },
        onNameInputEnter() {
            commitFocusedTable();
        },
    }));

    return (
        <>
            <Box display="flex" alignItems="center" gap="1" paddingX="1" paddingY="1.5">
                <IconButton
                    description="Back to field types"
                    size="sm"
                    variant="quiet"
                    onPress={onBack}
                >
                    <CaretLeft />
                </IconButton>
                <Box fontSize="75" fontStyle="semi-bold" color="grey-100">
                    Linked record
                </Box>
            </Box>
            <Box paddingX="1" paddingBottom="1">
                <input
                    {...inputProps}
                    ref={inputRef}
                    placeholder="Find a table"
                    className={classNames(
                        textInputClassName,
                        sprinkles({
                            display: "block",
                            width: "full",
                            height: "7",
                            paddingX: "2",
                            fontSize: "75",
                        }),
                    )}
                    onKeyDown={event => {
                        // Escape steps back to the field type page instead of react-aria's default of
                        // clearing the input.
                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            onBack();
                            return;
                        }
                        inputProps.onKeyDown?.(event);
                    }}
                />
            </Box>
            <DatabaseGridViewLinkedTableListBox
                listContainerRef={listContainerRef}
                listBoxRef={listBoxRef}
                listBoxProps={listBoxProps}
                comboBoxState={comboBoxState}
                isLoading={
                    isLoading ||
                    (keywordSearchOutput?.input.queryText.length === 0 && affinitySearch.isLoading)
                }
            />
            <Box borderTop="grey-5" padding="1.5">
                <Switch
                    isSelected={cardinality === "Many"}
                    onChange={isSelected => setCardinality(isSelected ? "Many" : "One")}
                >
                    Allow multiple links
                </Switch>
            </Box>
        </>
    );
}

function renderDatabaseGridViewLinkedTableItem(table: DatabaseGridViewLinkedTable) {
    return (
        <Item key={table.id} textValue={table.humanName}>
            <Box fontStyle="truncate">{table.humanName}</Box>
        </Item>
    );
}

function DatabaseGridViewLinkedTableListBox({
    listContainerRef,
    listBoxRef,
    listBoxProps,
    comboBoxState,
    isLoading,
}: {
    listContainerRef: Ref<HTMLDivElement>;
    listBoxRef: React.RefObject<HTMLUListElement | null>;
    listBoxProps: Parameters<typeof useListBox>[0];
    comboBoxState: ComboBoxState<DatabaseGridViewLinkedTable>;
    isLoading: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps: patchedListBoxProps} = useListBox(
        {
            ...listBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        comboBoxState,
        listBoxRef,
    );

    return (
        <div ref={listContainerRef}>
            <div
                ref={useMergedRefs(scrollRef, useScrollbar())}
                className={sprinkles({
                    position: "relative",
                    maxHeight: "48",
                    paddingX: "1",
                    paddingBottom: "1",
                    overflowX: "hidden",
                    overflowY: "auto",
                })}
            >
                <ul {...patchedListBoxProps} ref={listBoxRef}>
                    {isLoading ? (
                        <Box padding="1.5" fontSize="75" color="grey-50">
                            Loading...
                        </Box>
                    ) : comboBoxState.collection.size === 0 ? (
                        <Box padding="1.5" fontSize="75" color="grey-50">
                            No tables found
                        </Box>
                    ) : (
                        [...comboBoxState.collection].map(item => (
                            <DatabaseGridViewLinkedTableOption
                                key={item.key}
                                item={item}
                                comboBoxState={comboBoxState}
                            />
                        ))
                    )}
                </ul>
            </div>
        </div>
    );
}

function DatabaseGridViewLinkedTableOption({
    item,
    comboBoxState,
}: {
    item: Node<DatabaseGridViewLinkedTable>;
    comboBoxState: ComboBoxState<DatabaseGridViewLinkedTable>;
}) {
    const optionRef = useRef<HTMLLIElement>(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // Disable react-aria's press-on-trigger-then-drag-to-select behavior; see
            // `TaskCollectionComboBoxListBoxOption` for the full reasoning.
            disallowsDifferentPressOrigin: true,
        },
        comboBoxState,
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        optionRef,
    );

    // Only show the focus ring when the option was focused through the keyboard, not
    // when hovering moved the combobox's virtual focus.
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
                    display: "flex",
                    alignItems: "center",
                    padding: "1.5",
                    borderRadius: "1",
                    fontSize: "75",
                    color: "grey-100",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {item.rendered}
            </li>
        </FocusRing>
    );
}
