import {useDroppable} from "@dnd-kit/core";
import {useId} from "react";
import {Box} from "~/client/design/box";
import {TaskGridViewDroppableData} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {taskRowViewHeight} from "~/client/tasks/demo_2/task_row_presentational_view";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {contentSchemaStyles} from "~/shared/styles/styles";

export function TaskRowViewDroppable<TaskRow>({
    taskRow,
    indentation,
    nextAdjacentIndentation,
    previousAdjacentIndentation,
    isVerticallyFlipped,
}: {
    taskRow: TaskRow | null;
    indentation: number;
    nextAdjacentIndentation: number | null;
    previousAdjacentIndentation: number | null;
    isVerticallyFlipped?: boolean;
}) {
    const {isOver, setNodeRef: setDroppableNodeRef} = useDroppable({
        id: useId(),
        data: {
            type: "Row",
            taskRow,
            indentation,
        } satisfies TaskGridViewDroppableData<TaskRow>,
    });

    const listItemIndent = parseRemLengthNumber(contentSchemaStyles.listItemIndentation);

    return (
        <Box
            position="absolute"
            top={!isVerticallyFlipped ? "3" : "-6"}
            left="0"
            right="0"
            zIndex="10"
            pointerEvents="none"
            height={taskRowViewHeight}
        >
            <Box
                ref={setDroppableNodeRef}
                position="absolute"
                left="0"
                top="0"
                bottom="0"
                style={{
                    left:
                        previousAdjacentIndentation !== null
                            ? `${listItemIndent * indentation}rem`
                            : 0,
                    width:
                        nextAdjacentIndentation !== null && previousAdjacentIndentation !== null
                            ? `${
                                  listItemIndent *
                                  (nextAdjacentIndentation - previousAdjacentIndentation - 1)
                              }rem`
                            : nextAdjacentIndentation !== null
                            ? `${listItemIndent * nextAdjacentIndentation}rem`
                            : previousAdjacentIndentation !== null
                            ? `calc(100% - ${
                                  listItemIndent * (previousAdjacentIndentation + 1)
                              }rem)`
                            : "100%",
                }}
            ></Box>
            <Box
                position="absolute"
                right="5"
                bottom="3"
                pointerEvents="none"
                backgroundColor={isOver ? {light: "theme-30", dark: "theme-60"} : undefined}
                style={{
                    height: 1,
                    left: `${parseRemLengthNumber(spacing["5"]) + listItemIndent * indentation}rem`,
                }}
            />
            <Box
                position="absolute"
                bottom={!isVerticallyFlipped ? "3" : undefined}
                top={isVerticallyFlipped ? "6" : undefined}
                height="2"
                backgroundColor={isOver ? {light: "theme-30", dark: "theme-60"} : undefined}
                style={{
                    width: 1,
                    left: `${parseRemLengthNumber(spacing["5"]) + listItemIndent * indentation}rem`,
                }}
            />
        </Box>
    );
}
