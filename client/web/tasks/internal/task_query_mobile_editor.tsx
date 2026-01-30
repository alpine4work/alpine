import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function TaskQueryMobileEditor({
    initialName,
    onNameChange,
    onCloseWithAnimation,
}: {
    initialName: string;
    onNameChange: (name: string) => void;
    onCloseWithAnimation: () => void;
}) {
    const nameInputRef = useRef<HTMLInputElement>(null);

    const [{name, hasNameChanged}, setNameState] = useState({
        name: initialName,
        hasNameChanged: false,
    });

    const save = () => {
        onNameChange(name.trim());
        onCloseWithAnimation();
    };

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const nameInputElement = assertExists(nameInputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            nameInputElement.focus();

            nameInputElement.selectionStart = nameInputElement.selectionEnd =
                nameInputElement.value.length;
        });
    }, []);

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
                        pressErrorTitle="Couldn\u2019t go back"
                        onPress={onCloseWithAnimation}
                    >
                        Cancel
                    </Button>
                </Box>
                <Box fontSize="100" fontStyle="semi-bold">
                    Edit name
                </Box>
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-end"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        paddingX="2"
                        fontSize="100"
                        isDisabled={!hasNameChanged || name.trim().length === 0}
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
                    onEnter={save}
                />
            </Box>
        </Box>
    );
}
