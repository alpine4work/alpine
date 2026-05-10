/* eslint-disable react-refresh/only-export-components -- provider pattern */

import {TextAa} from "phosphor-react";
import {useEffect, useRef, useState} from "react";

import {
    type DatabaseGridViewCellContentProps,
    type DatabaseGridViewCellEditorOverlayProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {Box} from "~/client/web/design/box.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/web/design/text_area_with_auto_growing_height.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {databasePlainTextFieldProvider} from "~/shared/databases/fields/database_plain_text_field.js";

function DatabasePlainTextGridViewCellContent({
    ref,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"plainText">) {
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
            {value == null ? "" : String(value)}
        </Box>
    );
}

function DatabasePlainTextGridViewCellEditorOverlay({
    ref,
    initialValue,
    initialEditString,
    commitValue,
    onClose,
    moveSelection,
    onCreateRow,
}: DatabaseGridViewCellEditorOverlayProps<"plainText">) {
    const [editValue, setEditValue] = useState(initialEditString ?? initialValue);
    const localRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const textarea = localRef.current;
        if (textarea) {
            textarea.focus();
            textarea.selectionStart = textarea.value.length;
            textarea.selectionEnd = textarea.value.length;
        }
    }, []);

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            border="theme-40-const"
            backgroundColor="grey-0"
        >
            <TextAreaWithAutoGrowingHeight
                ref={localRef}
                value={editValue}
                onChange={e => setEditValue(e.currentTarget.value)}
                className={sprinkles({
                    width: "full",
                    padding: "2",
                    fontSize: "75",
                    color: "grey-100",
                })}
                onBlur={() => {
                    commitValue(editValue);
                    onClose();
                }}
                onKeyDown={e => {
                    if (e.key === "Enter" && e.shiftKey) {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        onCreateRow();
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        moveSelection(1, 0);
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        commitValue((e.currentTarget as HTMLTextAreaElement).value);
                        onClose();
                    }
                    e.stopPropagation();
                }}
            />
        </Box>
    );
}

export const databasePlainTextFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databasePlainTextFieldProvider,
    {
        label: "Text",
        Icon: TextAa,
        GridViewCellContent: DatabasePlainTextGridViewCellContent,
        GridViewCellEditorOverlay: DatabasePlainTextGridViewCellEditorOverlay,
        getConfigMenuActions: null,
    },
);
