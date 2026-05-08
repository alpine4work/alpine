/* eslint-disable react-refresh/only-export-components -- provider pattern */

import {useEffect, useRef, useState} from "react";

import {
    type DatabaseFieldConfigEditorPopoverProps,
    type DatabaseGridViewCellContentProps,
    type DatabaseGridViewCellEditorOverlayProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {databaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";

function DatabaseNumberGridViewCellContent({
    ref,
    config,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"number">) {
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            tabIndex={0}
            height="full"
            display="flex"
            alignItems="center"
            fontSize="75"
            fontStyle="truncate"
            padding="2"
            color="grey-100"
            onClick={onCellClick}
        >
            {databaseNumberFieldProvider.formatString(value, config)}
        </Box>
    );
}

function DatabaseNumberGridViewCellEditorOverlay({
    ref,
    config,
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
        const parsed = databaseNumberFieldProvider.parseString(raw, config);
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

function DatabaseNumberConfigEditorPopover({
    ref,
    config,
    onCommit,
    onClose,
}: DatabaseFieldConfigEditorPopoverProps<"number">) {
    const [editValue, setEditValue] = useState(
        config.decimalPlaces == null ? "" : String(config.decimalPlaces),
    );
    const localRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const input = localRef.current;
        if (input) {
            input.focus();
            input.select();
        }
    }, []);

    const commit = () => {
        const trimmed = editValue.trim();
        if (trimmed === "") {
            onCommit({type: "number", decimalPlaces: null});
        } else {
            const n = Number(trimmed);
            if (Number.isInteger(n) && n >= 0) {
                onCommit({type: "number", decimalPlaces: n});
            }
        }
        onClose();
    };

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            padding="2"
            display="flex"
            flexDirection="column"
            gap="1.5"
            style={{minWidth: 180}}
        >
            <Box fontSize="75" color="grey-80">
                Decimal places
            </Box>
            <input
                ref={localRef}
                type="text"
                inputMode="numeric"
                placeholder="Unlimited"
                value={editValue}
                onChange={e => setEditValue(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        onClose();
                    }
                    e.stopPropagation();
                }}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    fontSize: "75",
                    color: "grey-100",
                    border: "grey-10",
                    borderRadius: "1",
                })}
            />
        </Box>
    );
}

export const databaseNumberFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseNumberFieldProvider,
    {
        label: "Number",
        GridViewCellContent: DatabaseNumberGridViewCellContent,
        GridViewCellEditorOverlay: DatabaseNumberGridViewCellEditorOverlay,
        ConfigEditorPopover: DatabaseNumberConfigEditorPopover,
    },
);
