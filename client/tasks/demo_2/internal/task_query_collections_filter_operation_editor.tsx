import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {TaskQueryCollectionsFilter} from "~/client/tasks/demo_2/task_query_filter";

export function TaskQueryCollectionsFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryCollectionsFilter;
    onFilterChange: (filter: TaskQueryCollectionsFilter) => void;
}) {
    const includesOneOfOperatorLabel = "include";
    const excludesAllOfOperatorLabel = "don’t include";

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    filter.operation.type === "IncludesOneOf"
                        ? includesOneOfOperatorLabel
                        : excludesAllOfOperatorLabel
                }
                allOperators={[
                    {
                        label: includesOneOfOperatorLabel,
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {
                                    type: "IncludesOneOf",
                                    collectionIds: filter.operation.collectionIds,
                                },
                            });
                        },
                    },
                    {
                        label: excludesAllOfOperatorLabel,
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {
                                    type: "ExcludesAllOf",
                                    collectionIds: filter.operation.collectionIds,
                                },
                            });
                        },
                    },
                ]}
            />
        </>
    );
}
