import {DatabaseRelationRowName} from "~/client/web/databases/fields/relation/database_relation_row_name.js";
import {Box} from "~/client/web/design/box.js";

export function DatabaseRelationChip({name, noAccess}: {name: string | null; noAccess?: boolean}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            flexShrink="0"
            backgroundColor="grey-5"
            borderRadius="1"
            paddingX="1"
            fontSize="75"
            color={noAccess === true ? "grey-50" : "grey-100"}
            style={{maxWidth: 120}}
        >
            <Box fontStyle="truncate">
                {noAccess === true ? "No access" : <DatabaseRelationRowName name={name} />}
            </Box>
        </Box>
    );
}
