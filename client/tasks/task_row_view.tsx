import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

export type TaskRowViewRef = {
    focusStart(): void;
    focusEnd(): void;
};

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

function TaskRowView({isFirstRow}: {isFirstRow: boolean}, ref: Ref<TaskRowViewRef>) {
    const nameInputRef = useRef<HTMLInputElement>(null);

    const focusStart = useEvent(() => {
        const nameInputElement = assertExists(nameInputRef.current);
        nameInputElement.setSelectionRange(0, 0);
        nameInputElement.focus();
    });

    const focusEnd = useEvent(() => {
        const nameInputElement = assertExists(nameInputRef.current);
        nameInputElement.setSelectionRange(
            nameInputElement.value.length,
            nameInputElement.value.length,
        );
        nameInputElement.focus();
    });

    useImperativeHandle(ref, () => ({focusStart, focusEnd}), [focusEnd, focusStart]);

    return (
        <Box display="flex">
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                onClick={focusStart}
            />
            <Box
                flexGrow="1"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                <input
                    ref={nameInputRef}
                    placeholder={isFirstRow ? "Click to add a task…" : undefined}
                    style={contentSchemaStyles.paragraphFontSize}
                    className={sprinkles({
                        width: "full",
                        paddingY: "2",
                        backgroundColor: "transparent",
                    })}
                />
            </Box>
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                //
                // TODO(calebmer): When this has more fields focus should go to the last field,
                // not the name input.
                cursor="text"
                onClick={focusEnd}
            />
        </Box>
    );
}
