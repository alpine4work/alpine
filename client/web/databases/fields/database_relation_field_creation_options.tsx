import {useMemo} from "react";

import type {DatabaseGridViewFieldEditing} from "~/client/web/databases/grid_view/use_grid_view_fields.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";

export function DatabaseRelationFieldCreationOptions({
    editing,
}: {
    editing: DatabaseGridViewFieldEditing;
}) {
    const relationOptions = editing.relationOptions;
    const tablesResult = useReactiveDatabaseAction({
        name: "listTables",
        input: useMemo(() => ({}), []),
    });

    if (relationOptions == null) return null;

    return (
        <Box borderTop="grey-5" marginTop="1" paddingTop="1">
            <Box display="flex" gap="1" padding="1">
                {(["many", "one"] as const).map(cardinality => (
                    <Box
                        key={cardinality}
                        role="button"
                        aria-label={`Use ${cardinality} linked records`}
                        tabIndex={0}
                        flexGrow="1"
                        textAlign="center"
                        borderRadius="1"
                        padding="1"
                        fontSize="75"
                        cursor="pointer"
                        backgroundColor={
                            relationOptions.cardinality === cardinality ? "theme-10" : "grey-5"
                        }
                        color="grey-100"
                        onMouseDown={event => {
                            event.preventDefault();
                            relationOptions.updateCardinality(cardinality);
                        }}
                    >
                        {cardinality === "many" ? "Many" : "One"}
                    </Box>
                ))}
            </Box>
            <Box style={{maxHeight: 160, overflowY: "auto"}}>
                {tablesResult == null ? (
                    <Box padding="1.5" fontSize="75" color="grey-50">
                        Loading...
                    </Box>
                ) : !tablesResult.ok ? (
                    <Box padding="1.5" fontSize="75" color="red-60">
                        Could not load tables.
                    </Box>
                ) : (
                    tablesResult.value.tables.map(table => (
                        <Box
                            key={table.id}
                            role="button"
                            aria-label={`Link to table ${table.name}`}
                            tabIndex={0}
                            display="flex"
                            alignItems="center"
                            padding="1.5"
                            borderRadius="1"
                            fontSize="75"
                            color="grey-100"
                            cursor="pointer"
                            backgroundColor={
                                table.id === relationOptions.linkedTableId ? "theme-10" : undefined
                            }
                            onMouseDown={event => {
                                event.preventDefault();
                                relationOptions.updateLinkedTableId(table.id);
                            }}
                        >
                            <Box fontStyle="truncate">{table.name}</Box>
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
}
