import {useEffect, useRef, useState} from "react";

import type {DatabaseGridViewCellEditorOverlayProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {parseDatabaseNumberFieldValueString} from "~/shared/databases/fields/number/parse_database_number_field_value_string.js";

export function DatabaseNumberGridViewCellEditorOverlay({
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
        const parsed = parseDatabaseNumberFieldValueString(raw);
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
