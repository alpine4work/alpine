import {
    ReactElement,
    KeyboardEvent as ReactKeyboardEvent,
    Ref,
    forwardRef,
    useId,
    useRef,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    TextInputFontSize,
    textInputHeightSpacingForFontSize,
} from "~/client/web/design/text_input_height_spacing_for_font_size.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {isModifiedKeyboardEvent} from "~/client/web/helpers/events/is_modified_keyboard_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export type {TextInputFontSize} from "~/client/web/design/text_input_height_spacing_for_font_size.js";

export type TextInputProps = {
    /**
     * A label used to describe the text input.
     */
    label: string;

    /**
     * The current value of the text input.
     *
     * You may use `<ControlledTextInput/>` if you want a input component that manages
     * its own value.
     */
    value: string;

    /**
     * Fired when the value changes.
     *
     * You may use `<ControlledTextInput/>` if you want a input component that manages
     * its own value.
     */
    onChange: (value: string) => void;

    /**
     * If the enter key is pressed while focused on this text input this event fires.
     */
    onEnter?: () => void;

    /**
     * If the enter key is pressed with command (on MacOS) or control (on windows) this
     * event fires.
     */
    onModEnter?: () => void;

    /**
     * If the escape key is pressed while focused on this text input this event fires.
     */
    onEscape?: () => void;

    /**
     * Called when a key is pressed while the input is focused. Fires after the
     * built-in Enter/Escape handlers.
     */
    onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;

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
     * Is this input read-only? A read-only input is focusable but not editable. Unlike
     * a disabled input which is neither focused nor editable.
     */
    isReadOnly?: boolean;

    /**
     * Hint to the browser for what type of virtual keyboard to use when editing this
     * input. See the [HTML `inputmode` attribute docs][1] for valid values.
     *
     * Depending on what value you set, the input type might change.
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode
     */
    inputMode?: "tel" | "url" | "email" | "numeric" | "decimal" | "password" | "text";

    /**
     * Hint to the browser what it should allow users to auto-complete. See the [HTML
     * `autocomplete` attribute docs][1] for valid values.
     *
     * If you set to `email` then instead of `type="text"` we will set `type="email"`
     * on the input.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
     */
    autoComplete?: string;

    /**
     * Hint to the browser whether auto-capitalization should be allowed. See the [HTML
     * `autocaptialize` attribute docs][1].
     *
     * [1]:
     *     https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autocapitalize
     */
    autoCapitalize?: "sentences" | "words" | "none";

    /**
     * Name to assign this inputs value to when submitting a form.
     */
    formName?: string;

    /**
     * What font size should we use for the text in this input? Defaults to `75`.
     */
    fontSize?: TextInputFontSize;

    /**
     * What font should we use for this text input? Defaults to `normal`.
     */
    fontStyle?: "normal" | "extra-bold" | "code" | "code-extra-bold";

    /**
     * Should we use an italic font?
     */
    isFontItalic?: boolean;

    /**
     * Is there a strikethrough decoration on the font?
     */
    hasFontStrikeDecoration?: boolean;

    /**
     * Override the right padding of the text input.
     */
    paddingRight?: Spacing | number;

    /**
     * Remove the border and background from the input so it can be embedded inside
     * another container.
     */
    withoutBorder?: boolean;

    /**
     * An optional icon rendered to the left of the input.
     */
    icon?: ReactElement;

    /**
     * Are we forcing the focus ring to be visible? See the `isVisible` prop on
     * `<FocusRing>` for more information.
     */
    isFocusRingVisible?: boolean;

    /**
     * The maximum number of characters allowed in the input.
     */
    maxLength?: number;

    /**
     * What describes this text input for accessibility purposes?
     */
    "aria-describedby"?: string;
};

/**
 * Core styles for `<TextInput>` you can use to create other elements that look
 * like a text input.
 */
// This is a string so it's fine to export.
// eslint-disable-next-line react-refresh/only-export-components
export const textInputClassName = sprinkles({
    boxShadow: "elevation-5-with-grey-10-border",
    backgroundColor: "grey-0",
    color: "grey-100",
    borderRadius: "1",
});

/**
 * Simple, single-line, text input with a label.
 */
// TODO(calebmer): This is a very standard web design text input. Consider the
// design more closely. Should the label be on the side? Should we have some kind
// of dimensionality in the input?
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
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "truncate-semi-bold",
                    paddingBottom: "1.5",
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
        "aria-describedby": ariaDescribedby,
        value,
        onChange,
        onEnter,
        onModEnter,
        onEscape,
        onKeyDown,
        placeholder,
        isDisabled,
        isReadOnly,
        inputMode,
        autoComplete,
        autoCapitalize,
        formName,
        fontSize = "75",
        fontStyle = "normal",
        isFontItalic = false,
        hasFontStrikeDecoration = false,
        paddingRight,
        withoutBorder = false,
        icon,
        isFocusRingVisible = false,
        maxLength,
    }: Omit<TextInputProps, "label"> &
        // You must provide one of these props for accessibility! Or use `<TextInput>` that
        // comes with an accessible label.
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
            // NOTE(calebmer): This is a fix for what I consider to be a Safari bug. There's
            // much written on the topic in `content_editor.tsx` where we have the same
            // assignment to `caretColor`. Read there for more information.
            inputElement.style.caretColor = NativeMobileBridge ? "initial" : "-apple-system-blue";
        }
    }, []);

    const isCodeFontStyle = {
        normal: false,
        "extra-bold": false,
        code: true,
        "code-extra-bold": true,
    }[fontStyle];

    const inputElement = (
        <input
            ref={useMergedRefs(ref, inputRef)}
            className={sprinkles({
                ...(!withoutBorder
                    ? {
                          boxShadow: "elevation-5-with-grey-10-border",
                          backgroundColor: isDisabled || isReadOnly ? "grey-5" : "grey-0",
                      }
                    : {backgroundColor: "transparent"}),
                borderRadius: "1",
                display: "block",
                width: "full",
                height: icon ? undefined : textInputHeightSpacingForFontSize(fontSize),
                paddingX: icon ? undefined : ({"75": "2", "100": "2.5"} as const)[fontSize],
                paddingRight: typeof paddingRight !== "number" ? paddingRight : undefined,
                fontSize,
                fontStyle,
                color: isDisabled || isReadOnly ? "grey-70" : "grey-100",
            })}
            style={{
                ...(icon ? {flex: 1} : undefined),
                paddingRight: typeof paddingRight === "number" ? paddingRight : undefined,

                fontStyle: isFontItalic ? "italic" : undefined,
                // Italics in our code font is controlled by a variable font setting instead of
                // `font-style: italic`.
                // eslint-disable-next-line cyberworlds/string-quotes
                fontVariationSettings: isCodeFontStyle && isFontItalic ? '"ital" 1' : undefined,
                // Allow contextual alternate glyphs in regular text content.
                // eslint-disable-next-line cyberworlds/string-quotes
                fontFeatureSettings: inputType === "text" ? '"calt" on' : '"calt" off',
                // Was a strike requested for the font? Only render a strike if the value isn't
                // empty. Otherwise the strike renders on the placeholder which looks funny.
                ...(hasFontStrikeDecoration && value.length > 0
                    ? {textDecorationLine: "line-through", textDecorationThickness: 1}
                    : undefined),
            }}
            id={id}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            aria-describedby={ariaDescribedby}
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
            data-1p-ignore={
                (inputType === "email" || inputType === "password") && autoComplete === "off"
                    ? ""
                    : undefined
            }
            name={formName}
            enterKeyHint={onEnter ? "done" : undefined}
            maxLength={maxLength}
            onKeyDown={event => {
                if (
                    onModEnter &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Cmd+Enter on MacOS platforms should trigger the callback Ctrl+Enter on non-MacOS
                    // platforms should trigger the callback
                    (isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    onModEnter();
                    return;
                }

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

                onKeyDown?.(event);
            }}
        />
    );

    const focusRingElement = (
        <FocusRing offset="border" isVisible={isFocusRingVisible}>
            {inputElement}
        </FocusRing>
    );

    if (icon) {
        return (
            <Box
                display="flex"
                alignItems="center"
                gap="2"
                height={textInputHeightSpacingForFontSize(fontSize)}
                paddingX={({"75": "2", "100": "2.5"} as const)[fontSize]}
                borderRadius="1"
                className={sprinkles({
                    ...(!withoutBorder
                        ? {
                              boxShadow: "elevation-5-with-grey-10-border",
                              backgroundColor: isDisabled || isReadOnly ? "grey-5" : "grey-0",
                          }
                        : {backgroundColor: "transparent"}),
                })}
            >
                {icon}
                {focusRingElement}
            </Box>
        );
    }

    return focusRingElement;
});
