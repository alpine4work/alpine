import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {TaskCollectionChipBase} from "~/client/web/tasks/task_collection_chip_base.js";

export function TaskCollectionComboBoxInstructionalPlaceholder({
    createCollectionButton,
}: {
    createCollectionButton: ReactNode;
}) {
    return (
        <Box display="flex" flexDirection="column" padding="3" gap="3">
            <Box display="flex" alignItems="center" gap="2">
                <Box>
                    <Box fontStyle="semi-bold" fontSize="75" color="grey-100" paddingBottom="1">
                        My collections
                    </Box>
                    <Box fontSize="50" color="grey-50">
                        We&#x2019;ll recommend the collections you use most here
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
