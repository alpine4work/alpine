import {ReactNode} from "react";
import {Box} from "~/client/design/box";
import {TaskCollectionChipBase} from "~/client/tasks/demo_2/internal/task_collection_chip_base";

export function TaskCollectionsListBoxInstructionalPlaceholder({
    createCollectionButton,
}: {
    createCollectionButton: ReactNode;
}) {
    return (
        <Box display="flex" flexDirection="column" padding="3" gap="3">
            <Box display="flex" alignItems="flex-end" gap="1">
                <Box>
                    <Box fontStyle="semi-bold" fontSize="75" color="grey-text" paddingBottom="1">
                        Shared collections
                    </Box>
                    <Box fontSize="50" color="grey-50">
                        Collections help you organize related tasks
                    </Box>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-start"
                    alignItems="center"
                    gap="1"
                >
                    <Box display="flex" gap="1">
                        <TaskCollectionChipBase color="red" name="Bugs" />
                        <TaskCollectionChipBase color="green" name="Q3" />
                    </Box>
                    <Box>
                        <TaskCollectionChipBase color="cyan" name="Marketing" />
                    </Box>
                </Box>
            </Box>
            {createCollectionButton}
        </Box>
    );
}
