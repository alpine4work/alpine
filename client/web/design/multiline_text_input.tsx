import {useId, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export type MultilineTextInputProps = {
    /**
     * A label used to describe the text input.
     */
    label: string;

    /**
     * The current value of the text input.
     *
     * You may use `<ControlledMultilineTextInput/>` if you want a input component
     * that manages its own value.
     */
    value: string;

    /**
     * Fired when the value changes.
     *
     * You may use `<ControlledMultilineTextInput/>` if you want a input component
     * that manages its own value.
     */
    onChange: (value: string) => void;

    /**
     * Placeholder text for when the value is empty.
     */
    placeholder?: string;

    /**
     * Name to assign this inputs value to when submitting a form.
     */
    formName?: string;
};

/**
 * Simple, multi-line, text input with a label.
 */
// TODO(calebmer): This is a very standard web design text input. Consider the
// design more closely. Should the label be on the side? Should we have some
// kind of dimensionality in the input?
export function MultilineTextInput({
    label,
    value,
    onChange,
    placeholder,
    formName,
}: MultilineTextInputProps) {
    const id = useId();

    return (
        <Box fontSize="75">
            <label
                className={sprinkles({
                    display: "inline-block",
                    fontStyle: "semi-bold",
                    paddingBottom: "1",
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <FocusRing offset="border">
                <textarea
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        paddingX: "2",
                        paddingY: "1.5",
                        minHeight: "16",
                        border: "grey-20",
                        backgroundColor: "grey-0",
                        borderRadius: "1",
                    })}
                    style={{resize: "none"}}
                    id={id}
                    data-scrollbar="false"
                    value={value}
                    onChange={event => onChange(event.currentTarget.value)}
                    placeholder={placeholder}
                    autoComplete="off"
                    name={formName}
                />
            </FocusRing>
        </Box>
    );
}

/**
 * `<MultilineTextInput>` but manages its own state instead of requiring you to
 * do data down and actions up.
 */
export function ControlledMultilineTextInput(
    props: Omit<MultilineTextInputProps, "value" | "onChange"> & {
        initialValue?: string;
    },
) {
    const [value, setValue] = useState(props.initialValue ?? "");

    return <MultilineTextInput {...props} value={value} onChange={setValue} />;
}
