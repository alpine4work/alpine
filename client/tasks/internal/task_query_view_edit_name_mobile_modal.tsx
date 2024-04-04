import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";

export function TaskQueryViewEditNameMobileModal({
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

        if (!NativeMobileBridge) {
            nameInputRef.current?.focus();
            nameInputRef.current?.select();
        } else {
            // Focus input after the push animation finishes. Otherwise the web view may
            // not be mounted to the screen.
            NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
                nameInputRef.current?.focus();
                nameInputRef.current?.select();
            });
        }
    }, []);

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
                <Button
                    fontSize="100"
                    pressErrorTitle="Couldn’t go back"
                    onPress={onCloseWithAnimation}
                >
                    Cancel
                </Button>
                <Box fontSize="100" fontStyle="semi-bold">
                    Edit name
                </Box>
                <Button fontSize="100" isDisabled={!hasNameChanged} onPress={save}>
                    Save
                </Button>
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
            </Box>
        </Box>
    );
}
