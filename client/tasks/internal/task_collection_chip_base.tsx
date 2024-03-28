import {X} from "phosphor-react";
import {ReactNode, Ref, forwardRef} from "react";
import {usePress} from "react-aria";
import {IconButton} from "~/client/design/icon_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {Spacing, addRemLengths, spacing} from "~/shared/design/spacing.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";
import {Sprinkles, colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export const taskCollectionChipHeight: Spacing = "5";
export const taskCollectionChipPaddingY: Spacing = "0.5";
export const taskCollectionChipBorderRadius = "base";

const TaskCollectionChipBaseForwardRef = forwardRef(TaskCollectionChipBase);
export {TaskCollectionChipBaseForwardRef as TaskCollectionChipBase};

const chipClassName = sprinkles({
    height: taskCollectionChipHeight,
    fontSize: "75",
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
});

const colorDotContainerClassName = sprinkles({
    flexShrink: "0",
    width: "5",
    display: "flex",
    justifyContent: "center",
});

const colorDotClassNameByColor = new DefaultMap((color: Sprinkles["color"]) =>
    sprinkles({
        width: "1.5",
        height: "1.5",
        borderRadius: "full",
        backgroundColor: color,
    }),
);

const nameClassName = sprinkles({fontStyle: "truncate"});

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
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const isDisabled = !onPress;
    const {pressProps, isPressed} = usePress({isDisabled, onPress});

    return (
        <div
            // `react-aria` has a bug where `usePress()` will call `event.preventDefault()`
            // on `keydown` events even when disabled. Given a chip could include a text
            // `<input>` we don't want to prevent enter/space keypresses.
            {...(isDisabled ? omitObject(pressProps, ["onKeyDown", "onKeyUp"]) : pressProps)}
            ref={ref}
            className={chipClassName}
            style={{
                backgroundColor: isPressed ? colorSchemeVars["grey-10"] : colorSchemeVars["grey-5"],
                paddingRight: onRemove ? spacing["0.5"] : spacing["1.5"],
            }}
        >
            {color === null ? (
                <Spacer space="1.5" />
            ) : (
                <div className={colorDotContainerClassName}>
                    <div
                        className={colorDotClassNameByColor.getOrSetDefault(
                            getTaskCollectionColor(color),
                        )}
                    />
                </div>
            )}
            <div className={nameClassName}>{name}</div>
            {onRemove && (
                <div style={{paddingLeft: spacing["0.5"]}}>
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
