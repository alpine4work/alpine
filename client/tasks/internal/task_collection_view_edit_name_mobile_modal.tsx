import {Check} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {spacing} from "~/shared/design/spacing.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export function TaskCollectionViewEditNameMobileModal({
    initiallyFocusName,
    getInitialName,
    getInitialColor,
    onSave,
    onCloseWithAnimation,
}: {
    initiallyFocusName: boolean;
    getInitialName: () => string;
    getInitialColor: () => ThemeColor | null;
    onSave: ({
        name,
        hasNameChanged,
        color,
        hasColorChanged,
    }: {
        name: string;
        hasNameChanged: boolean;
        color: ThemeColor | null;
        hasColorChanged: boolean;
    }) => void;
    onCloseWithAnimation: () => void;
}) {
    const nameInputRef = useRef<HTMLInputElement>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: getInitialName(),
        hasNameChanged: false,
    }));

    const [{color, hasColorChanged}, setColorState] = useState(() => ({
        color: getInitialColor(),
        hasColorChanged: false,
    }));

    const onColorChange = (color: ThemeColor | null) => {
        setColorState({color, hasColorChanged: true});
    };

    const save = () => {
        onSave({
            name: name.trim(),
            hasNameChanged,
            color,
            hasColorChanged,
        });

        onCloseWithAnimation();
    };

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (!initiallyFocusName) return;

        return scheduleAfterNavigationAnimation(() => {
            nameInputRef.current?.focus();
            nameInputRef.current?.select();
        });
    }, [initiallyFocusName]);

    return (
        <Box width="full">
            <Box style={{paddingTop: "var(--safe-area-inset-top, 0px)"}} />
            <Box
                height={navigationBarHeight}
                paddingX="3"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
            >
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-start"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        fontSize="100"
                        pressErrorTitle="Couldn’t go back"
                        onPress={onCloseWithAnimation}
                    >
                        Cancel
                    </Button>
                </Box>
                <Box fontSize="100" fontStyle="semi-bold">
                    Edit collection
                </Box>
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-end"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        fontSize="100"
                        isDisabled={
                            (!hasNameChanged && !hasColorChanged) || name.trim().length === 0
                        }
                        onPress={save}
                    >
                        Save
                    </Button>
                </Box>
            </Box>
            <Box paddingX="4">
                <Spacer space="8" />
                <TextInput
                    ref={nameInputRef}
                    fontSize="100"
                    label="Name"
                    value={name}
                    onChange={name => setNameState({name, hasNameChanged: true})}
                    onEnter={save}
                />
                <Spacer space="5" />
                <Box>
                    <label
                        className={sprinkles({
                            display: "inline-block",
                            fontSize: "75",
                            fontStyle: "semi-bold",
                            paddingBottom: "2",
                        })}
                    >
                        Color
                    </label>
                    <Box display="flex" justifyContent="space-between">
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="None"
                            color={null}
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Red"
                            color="red"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Orange"
                            color="orange"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Yellow"
                            color="yellow"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Green"
                            color="green"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Blue"
                            color="blue"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Purple"
                            color="purple"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionViewDesktopHeaderColorSelectorButton
                            description="Pink"
                            color="pink"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function TaskCollectionViewDesktopHeaderColorSelectorButton({
    description,
    color,
    selectedColor,
    onSelectedColorChange,
}: {
    description: string;
    color: ThemeColor | null;
    selectedColor: ThemeColor | null;
    onSelectedColorChange: (color: ThemeColor | null) => void;
}) {
    return (
        <IconButton
            variant="accent"
            size="base"
            description={description}
            backgroundColor={getTaskCollectionColor(color)}
            onPress={() => onSelectedColorChange(color)}
        >
            {color === selectedColor && (
                <Check
                    weight="bold"
                    color={
                        colorSchemeVars[
                            color === null ? ("grey-50" as const) : (`${color}-80` as const)
                        ]
                    }
                />
            )}
        </IconButton>
    );
}
