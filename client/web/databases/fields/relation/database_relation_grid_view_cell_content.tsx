import type {DatabaseGridViewCellContentProps} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import {DatabaseRelationChip} from "~/client/web/databases/fields/relation/database_relation_chip.js";
import {Box} from "~/client/web/design/box.js";

export function DatabaseRelationGridViewCellContent({
    ref,
    field,
    value,
    onCellClick,
}: DatabaseGridViewCellContentProps<"Relation">) {
    const links = Array.isArray(value) ? value : [];
    const noAccess = field.linkedTableReadAccess === false;
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
                <DatabaseRelationChip key={link.id} name={link.name} noAccess={noAccess} />
            ))}
            {links.length > 3 ? (
                <Box fontSize="75" color="grey-50" flexShrink="0">
                    +{links.length - 3}
                </Box>
            ) : null}
        </Box>
    );
}
