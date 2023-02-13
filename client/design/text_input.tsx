import classNames from "classnames";
import {Ref, forwardRef, useId, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {isMac} from "~/client/helpers/is_mac";
import {sprinkles} from "~/shared/styles/styles";

export type TextInputProps = {
    /**
     * A label used to describe the text input.
     */
    label: string;

    /**
     * Don't show the label, only use it for assistive technology.
     */
    hideLabel?: boolean;

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
     * If the enter key is pressed while focused on this text input this
     * event fires.
     */
    onEnter?: () => void;

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
     * Should the label be stacked or inline? Defaults to `stacked`.
     */
    layout?: "stacked" | "inline";

    /**
     * What font size should we use for the text in this input? Defaults to `75`.
     */
    fontSize?: "75" | "200";

    /**
     * What font should we use for this text input? Defaults to `normal`.
     */
    fontStyle?: "normal" | "code";
};

const TextInputForwardRef = forwardRef(TextInput);
export {TextInputForwardRef as TextInput};

/**
 * Simple, single-line, text input with a label.
 */
// TODO(calebmer): This is a very standard web design text input. Consider the
// design more closely. Should the label be on the side? Should we have some
// kind of dimensionality in the input?
function TextInput(
    {
        label,
        hideLabel,
        value,
        onChange,
        onEnter,
        placeholder,
        autoComplete,
        formName,
        layout = "stacked",
        fontSize = "75",
        fontStyle = "normal",
    }: TextInputProps,
    ref: Ref<HTMLInputElement>,
) {
    const id = useId();

    return (
        <Box
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
            {!hideLabel && (
                <label
                    className={sprinkles({
                        display: "inline-block",
                        fontSize: "75",
                        fontStyle: "semi-bold",
                        paddingBottom: layout === "stacked" ? "1" : undefined,
                    })}
                    htmlFor={id}
                >
                    {label}
                </label>
            )}
            <FocusRing offset="border">
                <input
                    ref={ref}
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        height: ({"75": "7", "200": "10"} as const)[fontSize],
                        paddingX: ({"75": "2", "200": "3"} as const)[fontSize],
                        border: "grey-20",
                        backgroundColor: "grey-0",
                        borderRadius: "base",
                        fontSize,
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
                    aria-label={hideLabel ? label : undefined}
                    onKeyDown={event => {
                        if (
                            onEnter &&
                            event.key === "Enter" &&
                            !event.altKey &&
                            !event.shiftKey &&
                            // Ctrl+Enter on non-MacOS platforms should trigger the callback
                            (!isMac || !event.ctrlKey) &&
                            // Cmd+Enter on MacOS platforms should trigger the callback
                            (isMac || !event.metaKey)
                        ) {
                            event.preventDefault();
                            onEnter();
                            return;
                        }
                    }}
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
