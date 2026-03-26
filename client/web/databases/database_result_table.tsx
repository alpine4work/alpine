import {Memo, useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";

type DatabaseResultTableField = {
    readonly name: string;
    readonly columnName: string;
    readonly width: number;
};

const defaultFieldWidth = 200;

const alwaysRenderHeader: ReadonlyArray<number> = [0];

/**
 * Renders database rows in a virtualized grid with a
 * sticky header. When `fields` is provided, uses view
 * field metadata for column names and widths. Otherwise
 * infers columns from row object keys (for raw SQL).
 */
export function DatabaseResultTable({
    fields,
    rows: rawRows,
}: {
    fields?: ReadonlyArray<DatabaseResultTableField> | undefined;
    rows: ReadonlyArray<unknown>;
}) {
    const rows = rawRows as ReadonlyArray<Record<string, unknown>>;

    const resolvedFields = useMemo(() => {
        if (fields != null) return fields;
        if (rows.length === 0) return [];
        return Object.keys(rows[0]!).map(key => ({
            name: key,
            columnName: key,
            width: defaultFieldWidth,
        }));
    }, [fields, rows]);

    const renderItem: Memo<(index: number) => VirtualizedScrollViewItem> = useMemo(
        () =>
            function renderItem(index: number): VirtualizedScrollViewItem {
                if (index === 0) {
                    return {
                        key: "header",
                        minHeight: 32,
                        zIndex: "10",
                        withManualLayout: true,
                        render({ref, offset, shouldRenderWithRelativePositioning}) {
                            return (
                                <div
                                    style={
                                        shouldRenderWithRelativePositioning
                                            ? {position: "relative"}
                                            : {
                                                  position: "absolute",
                                                  top: offset,
                                                  left: 0,
                                                  right: 0,
                                                  bottom: 0,
                                              }
                                    }
                                >
                                    <div
                                        ref={ref}
                                        style={{
                                            position: shouldRenderWithRelativePositioning
                                                ? "relative"
                                                : "sticky",
                                            top: shouldRenderWithRelativePositioning
                                                ? undefined
                                                : 0,
                                            minHeight: 32,
                                        }}
                                    >
                                        <DatabaseResultTableHeaderRow fields={resolvedFields} />
                                    </div>
                                </div>
                            );
                        },
                    };
                }

                const row = rows[index - 1]!;
                const rowKey = typeof row._id === "string" ? row._id : `row-${index}`;
                return {
                    key: rowKey,
                    minHeight: 32,
                    node: <DatabaseResultTableDataRow fields={resolvedFields} row={row} />,
                };
            },
        [resolvedFields, rows],
    );

    if (rows.length === 0) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                No rows returned.
            </Box>
        );
    }

    return (
        <Box flexGrow="1" overflow="hidden">
            <VirtualizedScrollView
                itemCount={rows.length + 1}
                bufferedItemHeight={32}
                renderItem={renderItem}
                alwaysRenderAdditionalItemIndexes={alwaysRenderHeader}
            />
        </Box>
    );
}

function DatabaseResultTableHeaderRow({fields}: {fields: ReadonlyArray<DatabaseResultTableField>}) {
    return (
        <Box display="flex">
            {fields.map(field => (
                <Box
                    key={field.columnName}
                    backgroundColor="grey-5"
                    color="grey-80"
                    fontSize="75"
                    fontStyle="truncate-semi-bold"
                    padding="2"
                    textAlign="left"
                    borderBottom="grey-10"
                    style={{
                        width: field.width,
                        minWidth: field.width,
                        maxWidth: field.width,
                    }}
                >
                    {field.name}
                </Box>
            ))}
        </Box>
    );
}

function DatabaseResultTableDataRow({
    fields,
    row,
}: {
    fields: ReadonlyArray<DatabaseResultTableField>;
    row: Record<string, unknown>;
}) {
    return (
        <Box display="flex">
            {fields.map(field => (
                <Box
                    key={field.columnName}
                    fontSize="75"
                    fontStyle="truncate"
                    padding="2"
                    color="grey-100"
                    borderBottom="grey-10"
                    style={{
                        width: field.width,
                        minWidth: field.width,
                        maxWidth: field.width,
                    }}
                >
                    {row[field.columnName] == null ? "NULL" : String(row[field.columnName])}
                </Box>
            ))}
        </Box>
    );
}
