import {ReactNode, Ref, forwardRef} from "react";
import {Box} from "~/client/design/box";
import {Spacing} from "~/shared/design/spacing";
import {ThemeColor} from "~/shared/design/theme_colors";

export const taskCollectionChipHeight: Spacing = "5";
export const taskCollectionChipPaddingY: Spacing = "0.5";

const TaskCollectionChipBaseForwardRef = forwardRef(TaskCollectionChipBase);
export {TaskCollectionChipBaseForwardRef as TaskCollectionChipBase};

function TaskCollectionChipBase(
    {color, name}: {color: ThemeColor; name: ReactNode},
    ref: Ref<HTMLDivElement>,
) {
    return (
        <Box
            ref={ref}
            backgroundColor="grey-5"
            height={taskCollectionChipHeight}
            fontSize="75"
            paddingRight="1.5"
            paddingY={taskCollectionChipPaddingY}
            borderRadius="base"
            display="inline-flex"
            alignItems="center"
            // These two properties are particularly important for
            // `<TaskDetailCollectionsField>` which renders an `<input>` as `name` when
            // creating a new collection. If the user types a lot of content then the chip
            // should grow until we reach the max-width then the `<input>` within should
            // start scrolling.
            maxWidth="full"
            overflow="hidden"
        >
            <Box flexShrink="0" width="5" display="flex" justifyContent="center">
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={`${color}-50-const`}
                />
            </Box>
            <Box fontStyle="truncate">{name}</Box>
        </Box>
    );
}
