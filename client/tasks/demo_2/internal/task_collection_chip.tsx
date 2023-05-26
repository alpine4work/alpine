import {Box} from "~/client/design/box";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";

export function TaskCollectionChip({collection}: {collection: LocalTaskCollection}) {
    return (
        <Box
            backgroundColor="grey-5"
            height="5"
            fontSize="75"
            paddingRight="1.5"
            paddingY="0.5"
            borderRadius="base"
            display="flex"
            alignItems="center"
        >
            <Box width="5" display="flex" justifyContent="center">
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={`${collection.color}-50-const`}
                />
            </Box>
            <Box fontStyle="truncate">{collection.name}</Box>
        </Box>
    );
}
