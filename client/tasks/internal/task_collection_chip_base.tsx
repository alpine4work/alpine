import {X} from "phosphor-react";
import {ReactNode, Ref, forwardRef} from "react";
import {usePress} from "react-aria";
import {IconButton} from "~/client/design/icon_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {Sprinkles, sprinkles} from "~/shared/styles/styles.js";

export const taskCollectionChipHeight: Spacing = "5";
export const taskCollectionChipPaddingY: Spacing = "0.5";
export const taskCollectionChipBorderRadius = "base";

const TaskCollectionChipBaseForwardRef = forwardRef(TaskCollectionChipBase);
export {TaskCollectionChipBaseForwardRef as TaskCollectionChipBase};

function TaskCollectionChipBase(
    {
        color,
        name,
        onPress,
        onRemove,
    }: {
        color: ThemeColor | null;
        name: ReactNode;
        onPress?: () => void;
        onRemove?: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const isDisabled = !onPress;
    const {pressProps, isPressed} = usePress({isDisabled, onPress});

    return (
        <div
            // `react-aria` has a bug where `usePress()` will call `event.preventDefault()`
            // on `keydown` events even when disabled. Given a chip could include a text
            // `<input>` we don't want to prevent enter/space keypresses.
            {...(isDisabled ? omitObject(pressProps, ["onKeyDown", "onKeyUp"]) : pressProps)}
            ref={ref}
            className={sprinkles({
                backgroundColor: isPressed ? "grey-10" : "grey-5",
                height: taskCollectionChipHeight,
                fontSize: "75",
                paddingRight: onRemove ? "0.5" : "1.5",
                paddingY: taskCollectionChipPaddingY,
                borderRadius: taskCollectionChipBorderRadius,
                display: "inline-flex",
                alignItems: "center",
                // These two properties are particularly important for
                // `<TaskDetailCollectionsField>` which renders an `<input>` as `name` when
                // creating a new collection. If the user types a lot of content then the chip
                // should grow until we reach the max-width then the `<input>` within should
                // start scrolling.
                maxWidth: "full",
                overflow: "hidden",
            })}
        >
            {color === null ? (
                <Spacer space="1.5" />
            ) : (
                <div
                    className={sprinkles({
                        flexShrink: "0",
                        width: "5",
                        display: "flex",
                        justifyContent: "center",
                    })}
                >
                    <div
                        className={sprinkles({
                            width: "1.5",
                            height: "1.5",
                            borderRadius: "full",
                            backgroundColor: getTaskCollectionColor(color),
                        })}
                    />
                </div>
            )}
            <div className={sprinkles({fontStyle: "truncate"})}>{name}</div>
            {onRemove && (
                <div className={sprinkles({paddingLeft: "0.5"})}>
                    <IconButton
                        size="xs"
                        variant="quiet-above-grey-5-background"
                        borderRadius="sm"
                        // The user focuses the pill as a whole and hits the delete key to delete using
                        // the keyboard.
                        isTabbable={false}
                        description="Remove"
                        withoutTooltip={true}
                        onPress={onRemove}
                    >
                        <X size={addRemLengths(spacing["2"], spacing["0.5"])} />
                    </IconButton>
                </div>
            )}
        </div>
    );
}

export function getTaskCollectionColor(color: ThemeColor | null): Sprinkles["color"] {
    if (color === null) return "grey-20";
    return `${color}-50`;
}
