import {CaretLeft, CaretRight, type Icon as PhosphorIcon} from "phosphor-react";
import {type Ref, useEffect, useId, useMemo, useRef, useState} from "react";
import {useHover} from "react-aria";
import {
    type DatabaseFieldComponentProvider,
    databaseFieldComponentProviders,
} from "~/client/web/databases/fields/database_field_component_providers.js";
import {DatabaseGridViewNewField} from "~/client/web/databases/use_grid_view_fields.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Switch} from "~/client/web/design/switch.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {type DatabaseActionOutput} from "~/shared/databases/database_actions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

type DatabaseGridViewFieldCreationTable = DatabaseActionOutput<"listTables">["tables"][number];

type DatabaseGridViewFieldCreationScreen = "fieldType" | "linkedTable";

/**
 * The header cell contents for a field that's being created. Owns all the
 * intermediate creation state (draft name, highlighted field type, linked table
 * filter, cardinality) and reports the finished field through `onCommit`.
 *
 * Renders the field name input inline in the header with a popover below it: first
 * a field type list, then — for relation fields — a linked table picker with a
 * filter input and an "Allow multiple links" toggle. Focus stays on the inputs the
 * whole time; up/down arrows move the highlighted option and enter commits it.
 */
export function DatabaseGridViewFieldCreationCell({
    onCommit,
    onCancel,
}: {
    onCommit: (newField: DatabaseGridViewNewField) => void;
    onCancel: () => void;
}) {
    const baseId = useId();

    const [name, setName] = useState("");
    const [screen, setScreen] = useState<DatabaseGridViewFieldCreationScreen>("fieldType");
    const [highlightedFieldTypeIndex, setHighlightedFieldTypeIndex] = useState(0);
    const [tableFilter, setTableFilter] = useState("");
    const [highlightedTableIndex, setHighlightedTableIndex] = useState(0);
    const [cardinality, setCardinality] = useState<"one" | "many">("many");

    const nameInputRef = useRef<HTMLInputElement>(null);
    const filterInputRef = useRef<HTMLInputElement>(null);

    // Keep focus on the field name input on the field type screen and on the filter
    // input on the linked table screen.
    useEffect(() => {
        if (screen === "fieldType") {
            nameInputRef.current?.focus();
        } else {
            filterInputRef.current?.focus();
        }
    }, [screen]);

    const tablesResult = useReactiveDatabaseAction({
        name: "listTables",
        input: useMemo(() => ({}), []),
    });
    const tables = tablesResult?.ok ? tablesResult.value.tables : null;

    const filteredTables = useMemo(() => {
        if (tables == null) return null;
        const filter = tableFilter.trim().toLowerCase();
        if (filter === "") return tables;
        return tables.filter(table => table.name.toLowerCase().includes(filter));
    }, [tables, tableFilter]);

    const commitFieldType = useEvent((provider: DatabaseFieldComponentProvider) => {
        if (provider.type === "relation") {
            setScreen("linkedTable");
            return;
        }
        onCommit({type: provider.type, name: name.trim() || provider.label});
    });

    const commitLinkedTable = useEvent((table: DatabaseGridViewFieldCreationTable) => {
        onCommit({
            type: "relation",
            name: name.trim() || table.name,
            linkedTableId: table.id,
            cardinality,
        });
    });

    // On the field type screen the option count is fixed; on the linked table screen
    // it follows the filtered table list.
    const highlightedIndex =
        screen === "fieldType" ? highlightedFieldTypeIndex : highlightedTableIndex;
    const optionCount =
        screen === "fieldType"
            ? databaseFieldComponentProviders.length
            : (filteredTables?.length ?? 0);

    const moveHighlight = useEvent((delta: 1 | -1) => {
        if (optionCount === 0) return;
        const nextIndex = (highlightedIndex + delta + optionCount) % optionCount;
        if (screen === "fieldType") {
            setHighlightedFieldTypeIndex(nextIndex);
        } else {
            setHighlightedTableIndex(nextIndex);
            document
                .getElementById(getOptionId(baseId, screen, nextIndex))
                ?.scrollIntoView({block: "nearest"});
        }
    });

    const commitHighlighted = useEvent(() => {
        if (screen === "fieldType") {
            const provider = databaseFieldComponentProviders[highlightedFieldTypeIndex];
            if (provider != null) commitFieldType(provider);
        } else {
            const table = filteredTables?.[highlightedTableIndex];
            if (table != null) commitLinkedTable(table);
        }
    });

    const goBackToFieldTypes = useEvent(() => {
        setScreen("fieldType");
        setTableFilter("");
        setHighlightedTableIndex(0);
    });

    // Escape steps back one level: from the linked table screen to the field type
    // screen, then out of the creation flow entirely.
    const handleEscape = useEvent(() => {
        if (screen === "linkedTable") {
            goBackToFieldTypes();
        } else {
            onCancel();
        }
    });

    const handleInputKeyDown = useEvent((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        }
    });

    const outsidePressRef = useOutsidePress(() => onCancel());

    // The placeholder doubles as a preview of the default name used when the input is
    // left empty: the field type's label, or the linked table's name.
    const defaultName =
        screen === "fieldType"
            ? databaseFieldComponentProviders[highlightedFieldTypeIndex]?.label
            : filteredTables?.[highlightedTableIndex]?.name;

    return (
        <Box ref={outsidePressRef} height="full">
            <Overlay
                isVisible={true}
                placement="bottom-start"
                fallbackPlacements={["bottom-end"]}
                preventOverflow={false}
                overlay={
                    <DatabaseGridViewFieldCreationPopover
                        baseId={baseId}
                        screen={screen}
                        highlightedIndex={highlightedIndex}
                        filteredTables={filteredTables}
                        tablesLoadFailed={tablesResult != null && !tablesResult.ok}
                        tableFilter={tableFilter}
                        filterInputRef={filterInputRef}
                        cardinality={cardinality}
                        onChangeTableFilter={value => {
                            setTableFilter(value);
                            setHighlightedTableIndex(0);
                        }}
                        onChangeCardinality={setCardinality}
                        onInputKeyDown={handleInputKeyDown}
                        onInputEnter={commitHighlighted}
                        onInputEscape={handleEscape}
                        onSelectFieldType={commitFieldType}
                        onSelectTable={commitLinkedTable}
                        onBack={goBackToFieldTypes}
                    />
                }
            >
                <Box height="full" display="flex" alignItems="center" paddingX="0.5">
                    <TextInputWithoutLabel
                        ref={nameInputRef}
                        aria-label="Field name"
                        withoutBorder
                        value={name}
                        placeholder={defaultName}
                        maxLength={maxLabelStringLength}
                        onChange={setName}
                        onEnter={commitHighlighted}
                        onEscape={handleEscape}
                        onKeyDown={handleInputKeyDown}
                    />
                </Box>
            </Overlay>
        </Box>
    );
}

function DatabaseGridViewFieldCreationPopover({
    ref,
    baseId,
    screen,
    highlightedIndex,
    filteredTables,
    tablesLoadFailed,
    tableFilter,
    filterInputRef,
    cardinality,
    onChangeTableFilter,
    onChangeCardinality,
    onInputKeyDown,
    onInputEnter,
    onInputEscape,
    onSelectFieldType,
    onSelectTable,
    onBack,
}: {
    ref?: Ref<HTMLElement>;
    baseId: string;
    screen: DatabaseGridViewFieldCreationScreen;
    highlightedIndex: number;
    filteredTables: ReadonlyArray<DatabaseGridViewFieldCreationTable> | null;
    tablesLoadFailed: boolean;
    tableFilter: string;
    filterInputRef: Ref<HTMLInputElement>;
    cardinality: "one" | "many";
    onChangeTableFilter: (value: string) => void;
    onChangeCardinality: (value: "one" | "many") => void;
    onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onInputEnter: () => void;
    onInputEscape: () => void;
    onSelectFieldType: (provider: DatabaseFieldComponentProvider) => void;
    onSelectTable: (table: DatabaseGridViewFieldCreationTable) => void;
    onBack: () => void;
}) {
    const scrollbarRef = useScrollbar();

    return (
        <Box
            ref={ref as Ref<HTMLDivElement>}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            style={{minWidth: 200}}
        >
            {screen === "fieldType" ? (
                <Box role="listbox" aria-label="Field type" padding="1">
                    {databaseFieldComponentProviders.map((provider, index) => (
                        <DatabaseGridViewFieldCreationOption
                            key={provider.type}
                            id={getOptionId(baseId, screen, index)}
                            label={provider.label}
                            Icon={provider.Icon}
                            hasChildren={provider.type === "relation"}
                            isHighlighted={index === highlightedIndex}
                            onSelect={() => onSelectFieldType(provider)}
                        />
                    ))}
                </Box>
            ) : (
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
                        <TextInputWithoutLabel
                            ref={filterInputRef}
                            aria-label="Filter tables"
                            placeholder="Find a table"
                            value={tableFilter}
                            onChange={onChangeTableFilter}
                            onEnter={onInputEnter}
                            onEscape={onInputEscape}
                            onKeyDown={onInputKeyDown}
                        />
                    </Box>
                    <Box
                        ref={scrollbarRef}
                        role="listbox"
                        aria-label="Linked table"
                        position="relative"
                        paddingX="1"
                        paddingBottom="1"
                        overflowY="auto"
                        style={{maxHeight: 160}}
                    >
                        {filteredTables == null ? (
                            <Box
                                padding="1.5"
                                fontSize="75"
                                color={tablesLoadFailed ? "red-60" : "grey-50"}
                            >
                                {tablesLoadFailed ? "Could not load tables." : "Loading..."}
                            </Box>
                        ) : filteredTables.length === 0 ? (
                            <Box padding="1.5" fontSize="75" color="grey-50">
                                No tables found
                            </Box>
                        ) : (
                            filteredTables.map((table, index) => (
                                <DatabaseGridViewFieldCreationOption
                                    key={table.id}
                                    id={getOptionId(baseId, screen, index)}
                                    label={table.name}
                                    isHighlighted={index === highlightedIndex}
                                    onSelect={() => onSelectTable(table)}
                                />
                            ))
                        )}
                    </Box>
                    <Box borderTop="grey-5" padding="1.5">
                        <Switch
                            isSelected={cardinality === "many"}
                            onChange={isSelected =>
                                onChangeCardinality(isSelected ? "many" : "one")
                            }
                        >
                            Allow multiple links
                        </Switch>
                    </Box>
                </>
            )}
        </Box>
    );
}

function DatabaseGridViewFieldCreationOption({
    id,
    label,
    Icon,
    hasChildren = false,
    isHighlighted,
    onSelect,
}: {
    id: string;
    label: string;
    Icon?: PhosphorIcon;
    hasChildren?: boolean;
    isHighlighted: boolean;
    onSelect: () => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    return (
        <Box
            {...hoverProps}
            id={id}
            role="option"
            aria-selected={isHighlighted}
            display="flex"
            alignItems="center"
            gap="1.5"
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            backgroundColor={isHighlighted ? "theme-10" : isHovered ? "grey-5" : undefined}
            // `onMouseDown` with `preventDefault()` so selecting an option doesn't blur the
            // focused name/filter input.
            onMouseDown={event => {
                event.preventDefault();
                onSelect();
            }}
        >
            {Icon != null && <Icon size={14} />}
            <Box fontStyle="truncate">{label}</Box>
            {hasChildren && (
                <Box marginLeft="auto" display="flex" alignItems="center" color="grey-50">
                    <CaretRight size={12} />
                </Box>
            )}
        </Box>
    );
}

function getOptionId(
    baseId: string,
    screen: DatabaseGridViewFieldCreationScreen,
    index: number,
): string {
    return `${baseId}-${screen}-option-${index}`;
}
