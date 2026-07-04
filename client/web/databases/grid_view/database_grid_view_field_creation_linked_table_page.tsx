import classNames from "classnames";
import {CaretLeft} from "phosphor-react";
import {type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useComboBox, useFilter, useListBox, useOption} from "react-aria";
import {
    type ComboBoxState,
    type ComboBoxStateOptions,
    Item,
    type Node,
    useComboBoxState,
} from "react-stately";
import {DatabaseGridViewFieldCreationPageRef} from "~/client/web/databases/grid_view/database_grid_view_field_creation_page_ref.js";
import {DatabaseGridViewNewField} from "~/client/web/databases/use_grid_view_fields.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Switch} from "~/client/web/design/switch.js";
import {textInputClassName} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {type DatabaseActionOutput} from "~/shared/databases/database_actions.js";

type DatabaseGridViewLinkedTable = DatabaseActionOutput<"listTables">["tables"][number];

const emptyTables: ReadonlyArray<DatabaseGridViewLinkedTable> = [];

/**
 * The second page of the field creation popover, shown after picking "Linked
 * record": a combobox over the group's tables (filter input + list) with the
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
    const [cardinality, setCardinality] = useState<"one" | "many">("many");

    const inputRef = useRef<HTMLInputElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);
    const listContainerRef = useRef<HTMLDivElement>(null);

    const tablesResult = useReactiveDatabaseAction({
        name: "listTables",
        input: useMemo(() => ({}), []),
    });
    const tables = tablesResult?.ok ? tablesResult.value.tables : null;

    // The collection is controlled (we pass `items`), so filter it ourselves.
    const {contains} = useFilter({sensitivity: "base"});
    const filteredTables = useMemo(
        () => tables?.filter(table => contains(table.name, filterValue.trim())) ?? emptyTables,
        [tables, filterValue, contains],
    );

    const commitTable = useEvent((table: DatabaseGridViewLinkedTable) => {
        // An empty name defaults to the linked table's name.
        onCommit({
            name: name.trim() || table.name,
            config: {type: "relation", linkedTableId: table.id, cardinality},
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
            <Box display="flex" alignItems="center" gap="1" padding="1">
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
                tablesLoadFailed={tablesResult != null && !tablesResult.ok}
                isLoading={tablesResult == null}
            />
            <Box borderTop="grey-5" padding="1.5">
                <Switch
                    isSelected={cardinality === "many"}
                    onChange={isSelected => setCardinality(isSelected ? "many" : "one")}
                >
                    Allow multiple links
                </Switch>
            </Box>
        </>
    );
}

function renderDatabaseGridViewLinkedTableItem(table: DatabaseGridViewLinkedTable) {
    return (
        <Item key={table.id} textValue={table.name}>
            <Box fontStyle="truncate">{table.name}</Box>
        </Item>
    );
}

function DatabaseGridViewLinkedTableListBox({
    listContainerRef,
    listBoxRef,
    listBoxProps,
    comboBoxState,
    tablesLoadFailed,
    isLoading,
}: {
    listContainerRef: Ref<HTMLDivElement>;
    listBoxRef: React.RefObject<HTMLUListElement | null>;
    listBoxProps: Parameters<typeof useListBox>[0];
    comboBoxState: ComboBoxState<DatabaseGridViewLinkedTable>;
    tablesLoadFailed: boolean;
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
                    paddingX: "1",
                    paddingBottom: "1",
                    overflowX: "hidden",
                    overflowY: "auto",
                })}
                style={{maxHeight: 160}}
            >
                <ul {...patchedListBoxProps} ref={listBoxRef}>
                    {isLoading || tablesLoadFailed ? (
                        <Box
                            padding="1.5"
                            fontSize="75"
                            color={tablesLoadFailed ? "red-60" : "grey-50"}
                        >
                            {tablesLoadFailed ? "Could not load tables." : "Loading..."}
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
    const {optionProps, isFocused, isHovered} = useOption(
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

    return (
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
                cursor: "pointer",
                backgroundColor: isFocused ? "theme-10" : isHovered ? "grey-5" : undefined,
            })}
        >
            {item.rendered}
        </li>
    );
}
