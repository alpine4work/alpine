import type {DatabaseGridViewCellContentProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {Box} from "~/client/web/design/box.js";
import {formatDatabaseNumberFieldValueString} from "~/shared/databases/fields/number/format_database_number_field_value_string.js";

export function DatabaseNumberGridViewCellContent({
    ref,
    field,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"Number">) {
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
            {formatDatabaseNumberFieldValueString(value, field.config)}
        </Box>
    );
}
