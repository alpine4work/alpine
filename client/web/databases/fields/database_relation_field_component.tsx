/* eslint-disable react-refresh/only-export-components -- provider pattern */

import {LinkSimple, Plus, X} from "phosphor-react";
import {startTransition, useEffect, useMemo} from "react";

import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {
    type DatabaseGridViewCellContentProps,
    type DatabaseGridViewCellEditorOverlayProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {DatabaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";

const databaseRelationFieldProvider = new DatabaseRelationFieldProvider();

function DatabaseRelationGridViewCellContent({
    ref,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"relation">) {
    const links = Array.isArray(value) ? value : [];
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            tabIndex={-1}
            height="full"
            display="flex"
            alignItems="center"
            gap="1"
            padding="1"
            overflow="hidden"
            onClick={onCellClick}
        >
            {links.slice(0, 3).map(link => (
                <DatabaseRelationChip key={link.id} name={link.name} />
            ))}
            {links.length > 3 ? (
                <Box fontSize="75" color="grey-50" flexShrink="0">
                    +{links.length - 3}
                </Box>
            ) : null}
        </Box>
    );
}

function DatabaseRelationGridViewCellEditorOverlay({
    ref,
    tableId,
    fieldId,
    rowId,
    initialValue,
    onClose,
}: DatabaseGridViewCellEditorOverlayProps<"relation">) {
    const conn = useDatabaseConnection();
    const reporter = useReporter();
    const linkableRowsResult = useReactiveDatabaseAction({
        name: "listLinkableRows",
        input: useMemo(() => ({tableId, fieldId, rowId}), [tableId, fieldId, rowId]),
    });
    const links = Array.isArray(initialValue) ? initialValue : [];

    useEffect(() => {
        if (linkableRowsResult != null && !linkableRowsResult.ok) {
            reporter.logErrorWithoutDisplaying(
                "Could not load linked record options",
                linkableRowsResult.error,
            );
        }
    }, [linkableRowsResult, reporter]);

    const addLink = useEvent((linkedRowId: DatabaseRowId) => {
        startTransition(async () => {
            await conn.executeAction("addLink", {tableId, fieldId, rowId, linkedRowId});
        });
    });

    const removeLink = useEvent((linkedRowId: DatabaseRowId) => {
        startTransition(async () => {
            await conn.executeAction("removeLink", {tableId, fieldId, rowId, linkedRowId});
        });
    });

    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            border="theme-40-const"
            backgroundColor="grey-0"
            boxShadow="elevation-20"
            padding="1"
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                }
                event.stopPropagation();
            }}
            style={{minWidth: 240, maxWidth: 360}}
        >
            {links.length > 0 ? (
                <Box display="flex" flexWrap="wrap" gap="1" padding="1" borderBottom="grey-5">
                    {links.map(link => (
                        <DatabaseRelationEditableChip
                            key={link.id}
                            name={link.name}
                            onRemove={() => removeLink(link.id)}
                        />
                    ))}
                </Box>
            ) : null}
            <Box paddingTop="1">
                {linkableRowsResult == null ? null : linkableRowsResult.ok ? (
                    linkableRowsResult.value.rows.map(row => (
                        <DatabaseRelationRowOption
                            key={row.id}
                            name={row.name}
                            onPress={() => addLink(row.id)}
                        />
                    ))
                ) : (
                    <Box padding="1.5" fontSize="75" color="grey-50">
                        Could not load records
                    </Box>
                )}
            </Box>
        </Box>
    );
}

function DatabaseRelationChip({name}: {name: string | null}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            flexShrink="0"
            backgroundColor="grey-5"
            borderRadius="1"
            paddingX="1"
            fontSize="75"
            color="grey-100"
            style={{maxWidth: 120}}
        >
            <Box fontStyle="truncate">{name ?? "Untitled"}</Box>
        </Box>
    );
}

function DatabaseRelationEditableChip({
    name,
    onRemove,
}: {
    name: string | null;
    onRemove: () => void;
}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap="0.5"
            backgroundColor="grey-5"
            borderRadius="1"
            paddingLeft="1"
            paddingRight="0.5"
            fontSize="75"
            color="grey-100"
        >
            <Box fontStyle="truncate" style={{maxWidth: 160}}>
                {name ?? "Untitled"}
            </Box>
            <Box
                role="button"
                aria-label={`Remove ${name ?? "Untitled"}`}
                tabIndex={0}
                display="flex"
                alignItems="center"
                color="grey-50"
                cursor="pointer"
                onMouseDown={event => event.preventDefault()}
                onClick={event => {
                    event.stopPropagation();
                    onRemove();
                }}
            >
                <X size={12} />
            </Box>
        </Box>
    );
}

function DatabaseRelationRowOption({name, onPress}: {name: string | null; onPress: () => void}) {
    return (
        <Box
            role="button"
            aria-label={`Link ${name ?? "Untitled"}`}
            tabIndex={0}
            display="flex"
            alignItems="center"
            gap="1.5"
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
                event.stopPropagation();
                onPress();
            }}
        >
            <Box color="grey-50" display="flex" alignItems="center">
                <Plus size={14} />
            </Box>
            <Box fontStyle="truncate">{name ?? "Untitled"}</Box>
        </Box>
    );
}

export const databaseRelationFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseRelationFieldProvider,
    {
        label: "Linked record",
        Icon: LinkSimple,
        GridViewCellContent: DatabaseRelationGridViewCellContent,
        GridViewCellEditorOverlay: DatabaseRelationGridViewCellEditorOverlay,
        getConfigMenuActions: null,
    },
);
