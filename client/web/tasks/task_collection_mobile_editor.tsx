import {Check} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";

export function TaskCollectionMobileEditor({
    title,
    initiallyFocusName,
    getInitialName,
    getInitialColor,
    onSave,
    onCloseWithAnimation,
}: {
    title: string;
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
    }) => MaybePromise<void>;
    onCloseWithAnimation: (options: {hasSaved: boolean}) => void;
}) {
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
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

    const save = async () => {
        await onSave({
            name: name.trim(),
            hasNameChanged,
            color,
            hasColorChanged,
        });

        onCloseWithAnimation({hasSaved: true});
    };

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (!initiallyFocusName) return;

        const nameInputElement = assertExists(nameInputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            nameInputElement.focus();

            nameInputElement.selectionStart = nameInputElement.selectionEnd =
                nameInputElement.value.length;
        });
    }, [initiallyFocusName]);

    return (
        <Box width="full">
            <Box paddingTop="safe-area-inset" />
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
                        paddingX="2"
                        fontSize="100"
                        pressErrorTitle="Couldn&#x2019;t go back"
                        onPress={() => onCloseWithAnimation({hasSaved: false})}
                    >
                        Cancel
                    </Button>
                </Box>
                <Box fontSize="100" fontStyle="semi-bold">
                    {title}
                </Box>
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-end"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        ref={saveButtonRef}
                        paddingX="2"
                        fontSize="100"
                        isDisabled={
                            (!hasNameChanged && !hasColorChanged) || name.trim().length === 0
                        }
                        pressErrorTitle="Couldn&#x2019;t save collection"
                        onPress={save}
                    >
                        Save
                    </Button>
                </Box>
            </Box>
            <Box paddingX={screenPaddingX}>
                <Spacer space="5" />
                <TextInput
                    ref={nameInputRef}
                    fontSize="100"
                    label="Name"
                    value={name}
                    onChange={name => setNameState({name, hasNameChanged: true})}
                    onEnter={() => assertExists(saveButtonRef.current).press()}
                />
                <Spacer space="5" />
                <Box>
                    <label
                        className={sprinkles({
                            // `display: block; width: fit-content` is important here! As `inline-block`
                            // there's some weird additional vertical space underneath the label.
                            display: "block",
                            width: "fit-content",
                            maxWidth: "full",
                            fontSize: "75",
                            fontStyle: "semi-bold",
                            paddingBottom: "2.5",
                        })}
                    >
                        Color
                    </label>
                    <Box display="flex" justifyContent="space-between">
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="None"
                            color={null}
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Red"
                            color="red"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Orange"
                            color="orange"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Yellow"
                            color="yellow"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Green"
                            color="green"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Blue"
                            color="blue"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
                            description="Purple"
                            color="purple"
                            selectedColor={color}
                            onSelectedColorChange={onColorChange}
                        />
                        <TaskCollectionMobileEditorColorSelectorButton
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

function TaskCollectionMobileEditorColorSelectorButton({
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
                            color === null ? ("grey-60" as const) : (`${color}-80` as const)
                        ]
                    }
                />
            )}
        </IconButton>
    );
}
