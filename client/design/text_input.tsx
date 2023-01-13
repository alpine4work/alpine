import classNames from "classnames";
import {useId, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {sprinkles} from "~/shared/styles/styles";

export type TextInputProps = {
    /**
     * A label used to describe the text input.
     */
    label: string;

    /**
     * The current value of the text input.
     *
     * You may use `<ControlledTextInput/>` if you want a input component that
     * manages its own value.
     */
    value: string;

    /**
     * Fired when the value changes.
     *
     * You may use `<ControlledTextInput/>` if you want a input component that
     * manages its own value.
     */
    onChange: (value: string) => void;

    /**
     * Placeholder text for when the value is empty.
     */
    placeholder?: string;

    /**
     * Hint to the browser what it should allow users to auto-complete. See the
     * [HTML `autocomplete` attribute docs][1] for valid values.
     *
     * If you set to `email` then instead of `type="text"` we will set
     * `type="email"` on the input.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
     */
    autoComplete?: string;

    /**
     * Name to assign this inputs value to when submitting a form.
     */
    formName?: string;

    /**
     * Should the label be stacked or inline?
     *
     * @default "stacked"
     */
    layout?: "stacked" | "inline";

    /**
     * What font should we use for this text input?
     *
     * @default "normal"
     */
    fontStyle?: "normal" | "code";
};

/**
 * Simple, single-line, text input with a label.
 */
// TODO(calebmer): This is a very standard web design text input. Consider the
// design more closely. Should the label be on the side? Should we have some
// kind of dimensionality in the input?
export function TextInput({
    label,
    value,
    onChange,
    placeholder,
    autoComplete,
    formName,
    layout = "stacked",
    fontStyle = "normal",
}: TextInputProps) {
    const id = useId();

    return (
        <Box
            fontSize="xs"
            className={classNames(
                layout === "inline" &&
                    sprinkles({
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "4",
                        flex: "auto",
                    }),
            )}
        >
            <label
                className={sprinkles({
                    display: "inline-block",
                    fontStyle: "semi-bold",
                    paddingBottom: layout === "stacked" ? "1" : undefined,
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <FocusRing offset="border">
                <input
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        height: "7",
                        paddingX: "2",
                        border: "grey-20",
                        backgroundColor: "grey-0",
                        borderRadius: "base",
                        fontStyle,
                        flex: layout === "inline" ? "auto" : undefined,
                    })}
                    id={id}
                    type={autoComplete === "email" ? "email" : "text"}
                    value={value}
                    onChange={event => onChange(event.currentTarget.value)}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    name={formName}
                />
            </FocusRing>
        </Box>
    );
}

/**
 * `<TextInput>` but manages its own state instead of requiring you to do data
 * down and actions up.
 */
export function ControlledTextInput(
    props: Omit<TextInputProps, "value" | "onChange"> & {
        initialValue?: string;
    },
) {
    const [value, setValue] = useState(props.initialValue ?? "");

    return <TextInput {...props} value={value} onChange={setValue} />;
}
