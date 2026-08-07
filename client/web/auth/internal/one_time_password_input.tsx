import {Ref, useImperativeHandle, useMemo, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useIsFocusRingVisible} from "~/client/web/design/use_is_focus_ring_visible.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {
    interFontUnitsPerEm,
    interTabularZeroGlyphAdvanceWidth,
} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export type OneTimePasswordInputRef = {
    focus(): void;
};

export function OneTimePasswordInput({
    ref,
    oneTimePassword,
    onOneTimePasswordChange,
    isDisabled,
    formName,
}: {
    ref?: Ref<OneTimePasswordInputRef>;
    oneTimePassword: string;
    onOneTimePasswordChange: (oneTimePassword: string) => void;
    isDisabled?: boolean;
    formName?: string;
}) {
    const spacingScale = useSpacingScale();
    const [resizeRef, size] = useResizeObserver();
    const [isFocusRingVisible, focusRingRef] = useIsFocusRingVisible();

    const gap = "2";
    const fontSize = "700";

    const measurements = useMemo(() => {
        if (!size) return null;

        const gapPx = convertRemLengthToPx(gap, spacingScale);
        const fontSizePx = fontSizesBySpacingScale[fontSize][spacingScale].fontSize;
        const zeroWidthPx = fontSizePx * (interTabularZeroGlyphAdvanceWidth / interFontUnitsPerEm);

        const digitsWidthPx = size.width - gapPx * 5;
        const digitWidthPx = digitsWidthPx / 6;
        const digitPaddingXPx = digitWidthPx - zeroWidthPx;

        return {
            paddingLeft: digitPaddingXPx / 2,
            letterSpacing: digitPaddingXPx + gapPx,
        };
    }, [size, spacingScale]);

    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                assertExists(inputRef.current).focus();
            },
        }),
        [],
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        // Re-run effect whenever the password changes.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        oneTimePassword;

        // Make sure we reset any scroll the browser applies to the input to keep the
        // cursor visible when the input's value changes.
        const inputElement = assertExists(inputRef.current);
        inputElement.scrollLeft = 0;

        // Seems like the `scroll` event happens after our layout effect. Schedule an
        // animation frame to reset scroll works. This is kind of a hack. Ideally there'd
        // be some way to tell the browser not to scroll in the first place.
        requestAnimationFrame(() => {
            inputElement.scrollLeft = 0;
        });
    }, [oneTimePassword]);

    return (
        <Box ref={resizeRef} position="relative" zIndex="0">
            <Box style={{paddingTop: "20%"}} />
            <input
                ref={useMergedRefs<HTMLInputElement>(inputRef, focusRingRef)}
                name={formName}
                disabled={isDisabled}
                type="text"
                value={oneTimePassword}
                onChange={event => {
                    // Don't allow a user to type unsupported characters into our code.
                    const oneTimePassword = event.currentTarget.value
                        .replace(/[^0-9]/g, "")
                        .slice(0, 6);

                    onOneTimePasswordChange(oneTimePassword);
                }}
                onScroll={event => {
                    // If the input scrolls make sure to always scroll the input back to the left. For
                    // example, if the selection moves around the sixth character.
                    event.currentTarget.scrollLeft = 0;
                }}
                className={sprinkles({
                    display: "block",
                    position: "absolute",
                    inset: "0",
                    fontSize,
                    // Hide if `measurements` is null since we haven't computed the right letter
                    // spacing yet.
                    opacity: measurements ? "100" : "0",
                })}
                style={{
                    fontVariantNumeric: "tabular-nums",
                    paddingLeft: measurements?.paddingLeft,
                    letterSpacing: measurements?.letterSpacing,
                }}
                autoComplete="one-time-code"
                inputMode="numeric"
                aria-label="Passcode"
            />
            <Box
                position="absolute"
                inset="0"
                pointerEvents="none"
                display="flex"
                zIndex="-10"
                gap={gap}
                fontSize={fontSize}
                style={{
                    fontVariantNumeric: "tabular-nums",
                    ...inputPlaceholderStyles,
                }}
            >
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 0}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length === 0}
                />
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 1}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length === 1}
                />
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 2}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length === 2}
                />
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 3}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length === 3}
                />
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 4}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length === 4}
                />
                <OneTimePasswordDigit
                    isPlaceholder={oneTimePassword.length <= 5}
                    isFocusRingVisible={isFocusRingVisible && oneTimePassword.length >= 5}
                />
            </Box>
        </Box>
    );
}

function OneTimePasswordDigit({
    isPlaceholder,
    isFocusRingVisible,
}: {
    isPlaceholder: boolean;
    isFocusRingVisible: boolean;
}) {
    return (
        <FocusRing offset="border" isVisible={isFocusRingVisible} shouldIgnoreFocusEvents={true}>
            <Box
                flexGrow="1"
                height="full"
                borderRadius="1"
                boxShadow="elevation-5-with-grey-10-border"
                display="flex"
                justifyContent="center"
                alignItems="center"
                color="grey-20"
            >
                <Box aria-hidden={true} opacity={!isPlaceholder ? "0" : undefined}>
                    0
                </Box>
            </Box>
        </FocusRing>
    );
}
