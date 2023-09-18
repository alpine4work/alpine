import {useDroppable} from "@dnd-kit/core";
import {useId} from "react";
import {Box} from "~/client/design/box.js";
import {TaskGridViewDroppableData} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export function TaskRowViewDroppable({
    indentation,
    nextAdjacentIndentation,
    previousAdjacentIndentation,
    isPositionedAbove,
    isVerticallyFlipped,
    getDropActions,
}: {
    indentation: number;
    nextAdjacentIndentation: number | null;
    previousAdjacentIndentation: number | null;
    isPositionedAbove?: boolean;
    isVerticallyFlipped?: boolean;
    getDropActions: (taskId: TaskId) => Array<TaskAction>;
}) {
    const {isOver, setNodeRef: setDroppableNodeRef} = useDroppable({
        id: useId(),
        data: cast<TaskGridViewDroppableData>({
            type: "Row",
            getDropActions,
        }),
    });

    const listItemIndent = parseRemLengthNumber(contentSchemaStyles.listItemIndentation);

    return (
        <Box
            position="absolute"
            top={!isPositionedAbove ? "3" : "-6"}
            bottom={!isPositionedAbove ? "-3" : undefined}
            left="0"
            right="0"
            zIndex="10"
            pointerEvents="none"
            height={isPositionedAbove ? taskRowViewMinHeight : undefined}
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
