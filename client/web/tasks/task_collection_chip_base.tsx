import {X} from "phosphor-react";
import {ReactNode, Ref, forwardRef} from "react";
import {usePress} from "react-aria";
import {IconButton} from "~/client/web/design/icon_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskCollectionChipBorderRadius,
    taskCollectionChipHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {
    taskCollectionChipBaseClassNameBase,
    taskCollectionChipBaseColorDotClassNameByColor,
    taskCollectionChipBaseDesktopLayoutClassName,
    taskCollectionChipBaseDesktopLayoutColorDotContainerClassName,
    taskCollectionChipBaseDesktopLayoutWithoutColorClassName,
    taskCollectionChipBaseNameClassName,
    taskCollectionChipBaseNameGradientClassName,
} from "~/client/web/tasks/task_collection_chip_base_html.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

const TaskCollectionChipBaseForwardRef = forwardRef(TaskCollectionChipBase);
export {TaskCollectionChipBaseForwardRef as TaskCollectionChipBase};

const chipClassName = `${taskCollectionChipBaseClassNameBase} ${sprinkles({
    height: taskCollectionChipHeight,
    paddingRight: "1.5",
})}`;

const chipWithoutRemoveClassName = `${taskCollectionChipBaseClassNameBase} ${sprinkles({
    height: taskCollectionChipHeight,
    paddingRight: {desktop: "1.5", mobile: "2.5"},
})}`;

const chipWithoutColorClassName = `${chipClassName} ${sprinkles({
    paddingLeft: {desktop: "1.5", mobile: "2.5"},
})}`;

const chipWithoutColorAndWithoutRemoveClassName = `${chipWithoutRemoveClassName} ${sprinkles({
    paddingLeft: {desktop: "1.5", mobile: "2.5"},
})}`;

const colorDotContainerClassName = sprinkles({
    paddingLeft: {desktop: "1.5", mobile: "2.5"},
    paddingRight: {desktop: "1", mobile: "1.5"},
});

const removeButtonContainerClassName = sprinkles({
    marginLeft: "0.5",
    marginRight: {mobile: "-1", desktop: "-1.5"},
});

// IMPORTANT: If you update the HTML in this component you should also update
// `renderTaskCollectionChipBase()` for code that needs to render chips in
// `<ContentEditor>`.
function TaskCollectionChipBase(
    {
        color,
        name,
        nameMaxWidth,
        withDesktopLayout,
        tabIndex,
        onPress,
        onRemove,
    }: {
        color: ThemeColor | null;
        name: ReactNode;
        nameMaxWidth?: Spacing;
        withDesktopLayout?: boolean;
        tabIndex?: number;
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

    const platform = usePlatform();

    const isDisabled = !onPress;
    const {pressProps, isPressed} = usePress({isDisabled, onPress});

    const backgroundColor = isPressed ? colorSchemeVars["grey-10"] : colorSchemeVars["grey-5"];

    return (
        <div
            // `react-aria` has a bug where `usePress()` will call `event.preventDefault()`
            // on `keydown` events even when disabled. Given a chip could include a text
            // `<input>` we don't want to prevent enter/space keypresses.
            {...(isDisabled ? omitObject(pressProps, ["onKeyDown", "onKeyUp"]) : pressProps)}
            ref={ref}
            className={
                withDesktopLayout
                    ? color !== null
                        ? taskCollectionChipBaseDesktopLayoutClassName
                        : taskCollectionChipBaseDesktopLayoutWithoutColorClassName
                    : color !== null
                      ? onRemove
                          ? chipClassName
                          : chipWithoutRemoveClassName
                      : onRemove
                        ? chipWithoutColorClassName
                        : chipWithoutColorAndWithoutRemoveClassName
            }
            tabIndex={tabIndex}
            style={{backgroundColor}}
        >
            {color !== null && (
                <div
                    className={
                        withDesktopLayout
                            ? taskCollectionChipBaseDesktopLayoutColorDotContainerClassName
                            : colorDotContainerClassName
                    }
                >
                    <div
                        className={taskCollectionChipBaseColorDotClassNameByColor.getOrSetDefault(
                            getTaskCollectionColor(color),
                        )}
                    />
                </div>
            )}
            <div
                className={taskCollectionChipBaseNameClassName}
                style={{
                    maxWidth: nameMaxWidth ? spacing[nameMaxWidth] : undefined,
                    whiteSpace: "nowrap",
                    // Render contextual alternate glyphs. User text may be rendered here. Helpful
                    // for consistency if the user types anything like 2x2 or an @ mention.
                    // eslint-disable-next-line cyberworlds/string-quotes
                    fontFeatureSettings: '"calt" on',
                }}
            >
                <div
                    className={taskCollectionChipBaseNameGradientClassName}
                    style={{
                        background: `linear-gradient(to right, transparent, ${backgroundColor} ${spacing["0.5"]})`,
                    }}
                />
                {name}
            </div>
            {onRemove &&
                // If we're on mobile but `withDesktopLayout` is true then never render the
                // remove button since it would be too small.
                !(platform === "mobile" && withDesktopLayout) && (
                    <div className={removeButtonContainerClassName}>
                        <IconButton
                            size={platform === "mobile" ? "md" : "xs"}
                            variant="quiet-above-grey-5-background"
                            borderRadius={taskCollectionChipBorderRadius}
                            // The user focuses the pill as a whole and hits the delete key to delete using
                            // the keyboard.
                            isTabbable={false}
                            description="Remove"
                            withoutTooltip={true}
                            onPress={onRemove}
                        >
                            <X size={platform === "mobile" ? spacing["3"] : spacing["2.5"]} />
                        </IconButton>
                    </div>
                )}
        </div>
    );
}
