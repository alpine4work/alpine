import type {DatabaseGridViewCellContentProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {Box} from "~/client/web/design/box.js";

export function DatabasePlainTextGridViewCellContent({
    ref,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"plainText">) {
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
            {value == null ? "" : String(value)}
        </Box>
    );
}
