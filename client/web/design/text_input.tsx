import {Ref, forwardRef, useId, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {isModifiedKeyboardEvent} from "~/client/web/helpers/events/is_modified_keyboard_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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
     * If the enter key is pressed while focused on this text input this
     * event fires.
     */
    onEnter?: () => void;

    /**
     * If the escape key is pressed while focused on this text input this
     * event fires.
     */
    onEscape?: () => void;

    /**
     * Placeholder text for when the value is empty.
     */
    placeholder?: string;

    /**
     * Is this input disabled? A disabled input is neither focusable nor editable.
     * Unlike a read-only input which is focusable but not editable.
     */
    isDisabled?: boolean;

    /**
     * Is this input read-only? A read-only input is focusable but not editable.
     * Unlike a disabled input which is neither focused nor editable.
     */
    isReadOnly?: boolean;

    /**
     * Hint to the browser for what type of virtual keyboard to use when editing
     * this input. See the [HTML `inputmode` attribute docs][1] for valid values.
     *
     * Depending on what value you set, the input type might change.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode
     */
    inputMode?: "tel" | "url" | "email" | "numeric" | "decimal" | "password" | "text";

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
     * Hint to the browser whether auto-capitalization should be allowed. See the
     * [HTML `autocaptialize` attribute docs][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autocapitalize
     */
    autoCapitalize?: "sentences" | "words" | "none";

    /**
     * Name to assign this inputs value to when submitting a form.
     */
    formName?: string;

    /**
     * What font size should we use for the text in this input? Defaults to `75`.
     */
    fontSize?: "75" | "100";

    /**
     * What font should we use for this text input? Defaults to `normal`.
     */
    fontStyle?: "normal" | "code";

    /**
     * Override the right padding of the text input.
     */
    paddingRight?: Spacing;

    /**
     * Are we forcing the focus ring to be visible? See the `isVisible` prop on
     * `<FocusRing>` for more information.
     */
    isFocusRingVisible?: boolean;

    /**
     * The maximum number of characters allowed in the input.
     */
    maxLength?: number;
};

/**
 * Core styles for `<TextInput>` you can use to create other elements that look
 * like a text input.
 */
// This is a string so it's fine to export.
// eslint-disable-next-line react-refresh/only-export-components
export const textInputClassName = sprinkles({
    border: "grey-20",
    backgroundColor: "grey-0",
    color: "grey-100",
    borderRadius: "1",
});

/**
 * Simple, single-line, text input with a label.
 */
// TODO(calebmer): This is a very standard web design text input. Consider the
// design more closely. Should the label be on the side? Should we have some
// kind of dimensionality in the input?
export const TextInput = forwardRef(function TextInput(
    props: TextInputProps,
    ref: Ref<HTMLInputElement>,
) {
    const {label} = props;

    const id = useId();

    return (
        <Box>
            <label
                className={sprinkles({
                    display: "inline-block",
                    fontSize: "75",
                    fontStyle: "semi-bold",
                    paddingBottom: "1",
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <TextInputWithoutLabel {...props} ref={ref} id={id} />
        </Box>
    );
});

export const TextInputWithoutLabel = forwardRef(function TextInputWithoutLabel(
    {
        id,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledby,
        value,
        onChange,
        onEnter,
        onEscape,
        placeholder,
        isDisabled,
        isReadOnly,
        inputMode,
        autoComplete,
        autoCapitalize,
        formName,
        fontSize = "75",
        fontStyle = "normal",
        paddingRight,
        isFocusRingVisible = false,
        maxLength,
    }: Omit<TextInputProps, "label"> &
        // You must provide one of these props for accessibility! Or use `<TextInput>`
        // that comes with an accessible label.
        (| {id: string; "aria-label"?: undefined; "aria-labelledby"?: undefined}
            | {"aria-label": string; id?: undefined; "aria-labelledby"?: undefined}
            | {"aria-labelledby": string; id?: undefined; "aria-label"?: undefined}
        ),
    ref: Ref<HTMLInputElement>,
) {
    const {isAppleDevice} = useClientInfo();

    const inputRef = useRef<HTMLInputElement>(null);

    const inputType =
        inputMode === "url" || autoComplete === "url"
            ? "url"
            : inputMode === "email" || autoComplete === "email"
              ? "email"
              : inputMode === "password" || autoComplete === "password"
                ? "password"
                : "text";

    useLayoutEffectWithoutServerSideWarning(() => {
        const inputElement = assertExists(inputRef.current);

        if (isMobileWebKit) {
            // NOTE(calebmer): This is a fix for what I consider to be a Safari bug.
            // There's much written on the topic in `content_editor.tsx` where we have the
            // same assignment to `caretColor`. Read there for more information.
            inputElement.style.caretColor = NativeMobileBridge ? "initial" : "-apple-system-blue";
        }
    }, []);

    return (
        <FocusRing offset="border" isVisible={isFocusRingVisible}>
            <input
                ref={useMergedRefs(ref, inputRef)}
                className={sprinkles({
                    boxShadow: "elevation-5-with-grey-10-border",
                    borderRadius: "1",
                    display: "block",
                    width: "full",
                    height: ({"75": "7", "100": "9"} as const)[fontSize],
                    paddingX: ({"75": "2", "100": "2.5"} as const)[fontSize],
                    paddingRight,
                    fontSize,
                    fontStyle,
                    backgroundColor: isDisabled || isReadOnly ? "grey-5" : "grey-0",
                    color: isDisabled || isReadOnly ? "grey-70" : "grey-100",
                })}
                style={{
                    // Allow contextual alternate glyphs in regular text content.
                    // eslint-disable-next-line cyberworlds/string-quotes
                    fontFeatureSettings: inputType === "text" ? '"calt" on' : '"calt" off',
                }}
                id={id}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledby}
                type={inputType}
                value={value}
                onChange={event => onChange(event.currentTarget.value)}
                placeholder={placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                autoComplete={autoComplete}
                autoCapitalize={autoCapitalize}
                // If this is a password input and we've set `autoComplete` to `off`, then also
                // tell 1Password to ignore this field.
                // https://developer.1password.com/docs/web/compatible-website-design/#ignore-offers-to-save-or-fill-specific-fields
                data-1p-ignore={inputType === "password" && autoComplete === "off" ? "" : undefined}
                name={formName}
                enterKeyHint={onEnter ? "done" : undefined}
                maxLength={maxLength}
                onKeyDown={event => {
                    if (
                        onEnter &&
                        event.key === "Enter" &&
                        !event.altKey &&
                        !event.shiftKey &&
                        // Ctrl+Enter on non-MacOS platforms should trigger the callback
                        (!isAppleDevice || !event.ctrlKey) &&
                        // Cmd+Enter on MacOS platforms should trigger the callback
                        (isAppleDevice || !event.metaKey)
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        onEnter();
                        return;
                    }

                    if (onEscape && event.key === "Escape" && !isModifiedKeyboardEvent(event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        onEscape();
                        return;
                    }
                }}
            />
        </FocusRing>
    );
});
