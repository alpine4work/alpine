import {X} from "phosphor-react";
import {ReactNode, Ref, forwardRef} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {ThemeColor} from "~/shared/design/theme_colors";

export const taskCollectionChipHeight: Spacing = "5";
export const taskCollectionChipPaddingY: Spacing = "0.5";

const TaskCollectionChipBaseForwardRef = forwardRef(TaskCollectionChipBase);
export {TaskCollectionChipBaseForwardRef as TaskCollectionChipBase};

function TaskCollectionChipBase(
    {
        color,
        name,
        onRemove,
    }: {
        color: ThemeColor;
        name: ReactNode;
        onRemove: (() => void) | null;
    },
    ref: Ref<HTMLDivElement>,
) {
    return (
        <Box
            ref={ref}
            backgroundColor="grey-5"
            height={taskCollectionChipHeight}
            fontSize="75"
            paddingRight={onRemove ? "0.5" : "1.5"}
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
            {onRemove && (
                <Box paddingLeft="0.5">
                    <IconButton
                        size="xs"
                        variant="quiet-above-grey-5-background"
                        borderRadius="sm"
                        // The user focuses the pill as a whole and hits the delete key to delete using
                        // the keyboard.
                        disableKeyboardFocus={true}
                        description="Remove"
                        withoutTooltip={true}
                        onPress={onRemove}
                    >
                        <X size={addRemLengths(spacing["2"], spacing["0.5"])} />
                    </IconButton>
                </Box>
            )}
        </Box>
    );
}
