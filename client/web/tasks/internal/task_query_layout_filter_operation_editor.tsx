import {Box} from "~/client/web/design/box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {TaskQueryLayoutFilter} from "~/shared/tasks/task_query_filter.js";

export function TaskQueryLayoutFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryLayoutFilter;
    onFilterChange: (filter: TaskQueryLayoutFilter) => void;
}) {
    const isProject = getTaskQueryLayoutFilterIsProject(filter);

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={isProject ? "is" : "is not"}
                allOperators={[
                    {
                        label: "is",
                        isSelected: isProject,
                        onPress: () => {
                            onFilterChange({
                                type: "Layout",
                                operation: {
                                    type: "OneOf",
                                    layouts: ["Project"],
                                },
                            });
                        },
                    },
                    {
                        label: "is not",
                        isSelected: !isProject,
                        onPress: () => {
                            onFilterChange({
                                type: "Layout",
                                operation: {
                                    type: "NoneOf",
                                    layouts: ["Project"],
                                },
                            });
                        },
                    },
                ]}
            />
            <Box paddingX="1" height="full" display="flex" alignItems="center">
                project
            </Box>
        </>
    );
}

function getTaskQueryLayoutFilterIsProject(filter: TaskQueryLayoutFilter): boolean {
    switch (filter.operation.type) {
        case "OneOf":
            return filter.operation.layouts.includes("Project");
        case "NoneOf":
            return !filter.operation.layouts.includes("Project");
    }
}
