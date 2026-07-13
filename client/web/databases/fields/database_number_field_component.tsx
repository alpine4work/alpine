/* eslint-disable react-refresh/only-export-components -- provider pattern */

import {Hash} from "phosphor-react";
import {useEffect, useRef, useState} from "react";

import {
    type DatabaseGridViewCellContentProps,
    type DatabaseGridViewCellEditorOverlayProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {databaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";

function DatabaseNumberGridViewCellContent({
    ref,
    field,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"number">) {
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            tabIndex={-1}
            height="full"
            display="flex"
            alignItems="center"
            fontSize="75"
            fontStyle="truncate"
            padding="2"
            color="grey-100"
            onClick={onCellClick}
        >
            {databaseNumberFieldProvider.valueToString(value, field.config)}
        </Box>
    );
}

function DatabaseNumberGridViewCellEditorOverlay({
    ref,
    initialValue,
    initialEditString,
    commitValue,
    onClose,
    moveSelection,
    onCreateRow,
}: DatabaseGridViewCellEditorOverlayProps<"number">) {
    const [editValue, setEditValue] = useState(
        initialEditString ?? (initialValue == null ? "" : String(initialValue)),
    );
    const localRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const input = localRef.current;
        if (input) {
            input.focus();
            input.selectionStart = input.value.length;
            input.selectionEnd = input.value.length;
        }
    }, []);

    const tryCommit = (raw: string) => {
        const parsed = databaseNumberFieldProvider.parseValueString(raw);
        if (parsed.ok) commitValue(parsed.value);
    };

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            border="theme-40-const"
            backgroundColor="grey-0"
        >
            <input
                ref={localRef}
                type="text"
                inputMode="decimal"
                value={editValue}
                onChange={e => setEditValue(e.currentTarget.value)}
                className={sprinkles({
                    width: "full",
                    padding: "2",
                    fontSize: "75",
                    color: "grey-100",
                })}
                onBlur={() => {
                    tryCommit(editValue);
                    onClose();
                }}
                onKeyDown={e => {
                    if (e.key === "Enter" && e.shiftKey) {
                        e.preventDefault();
                        tryCommit(e.currentTarget.value);
                        onCreateRow();
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        tryCommit(e.currentTarget.value);
                        moveSelection(1, 0);
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        tryCommit(e.currentTarget.value);
                        onClose();
                    }
                    e.stopPropagation();
                }}
            />
        </Box>
    );
}

const decimalPlacesOptions: ReadonlyArray<{label: string; value: number | null}> = [
    {label: "Default", value: null},
    {label: "0", value: 0},
    {label: "1", value: 1},
    {label: "2", value: 2},
    {label: "3", value: 3},
    {label: "4", value: 4},
    {label: "5", value: 5},
    {label: "6", value: 6},
];

export const databaseNumberFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseNumberFieldProvider,
    {
        label: "Number",
        Icon: Hash,
        GridViewCellContent: DatabaseNumberGridViewCellContent,
        GridViewCellEditorOverlay: DatabaseNumberGridViewCellEditorOverlay,
        getConfigMenuActions: ({config, onCommit}) => [
            {
                hasChildren: true,
                key: "decimal-places",
                label: "Decimal places",
                actions: decimalPlacesOptions.map(option => ({
                    label: option.label,
                    isSelected: option.value === config.decimalPlaces,
                    onPress: () => {
                        onCommit({type: "number", decimalPlaces: option.value});
                    },
                })),
            },
        ],
    },
);
