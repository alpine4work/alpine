import {ArrowUp, Plus} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonNegativeMarginX,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputPaddingY,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, inputPlaceholderStyles} from "~/client/web/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

/**
 * Stands in for a message input the account can't write to, explaining why in
 * `children`. Borrows the real input's sizing so a surface can swap one for the
 * other without its layout shifting, and renders the reason where the placeholder
 * would be — it reads as a disabled input rather than as an error.
 *
 * Surfaces keep their own chrome around this (the forum's bottom bar, the task
 * detail view's virtualized slot) and render it where the live input would go.
 */
export function DisabledMessageInput({children}: {children: ReactNode}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();

    const iconButtonBoxStyle = {
        width: messageInputEditorMinHeightPx[platform][spacingScale],
        height: messageInputEditorMinHeightPx[platform][spacingScale],
    };

    return (
        <Box
            data-testid={process.env.NODE_ENV !== "production" ? "DisabledMessageInput" : undefined}
            width="full"
            maxWidth={contentStyles.contentMaxWidth}
            marginX="center"
            // Opaque for the same reason the real `<MessageInput>` is: surfaces render this
            // over scrolled content (the task detail view's sticky virtualized slot), so
            // without a background the messages behind it show through the input.
            backgroundColor="grey-0"
        >
            <Box
                paddingX={screenPaddingX}
                paddingY={messageInputPaddingY}
                marginX={messageInputEditorIconButtonNegativeMarginX}
            >
                <Box
                    position="relative"
                    zIndex="0"
                    style={{
                        minHeight: messageInputEditorMinHeightPx[platform][spacingScale],
                        borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                    }}
                >
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        zIndex="10"
                        inset="0"
                        border="grey-10"
                        style={{
                            borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                        }}
                    />
                    <Box
                        fontStyle="truncate"
                        color="grey-40"
                        style={{
                            ...contentStyles.paragraphFontSize,
                            fontWeight: inputPlaceholderStyles.fontWeight,
                            paddingTop: messageInputEditorPaddingYPx[platform][spacingScale],
                            paddingBottom: messageInputEditorPaddingYPx[platform][spacingScale],
                            paddingLeft: messageInputEditorPaddingX[platform],
                            paddingRight: messageInputEditorPaddingX[platform],
                        }}
                    >
                        {children}
                    </Box>
                    {/* Inert copies of the real input's buttons, so swapping between the two
                        doesn't change the input's shape. */}
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        left="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={iconButtonBoxStyle}
                    >
                        <IconButton
                            size={messageInputEditorIconButtonSize}
                            description="Disabled"
                            withoutTooltip={true}
                            isDisabled={true}
                            isFocusable={false}
                        >
                            <Plus />
                        </IconButton>
                    </Box>
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        right="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={iconButtonBoxStyle}
                    >
                        <IconButton
                            size={messageInputEditorIconButtonSize}
                            variant="accent"
                            description="Disabled"
                            withoutTooltip={true}
                            isDisabled={true}
                            isFocusable={false}
                        >
                            <ArrowUp
                                size={spacing["4"]}
                                style={{
                                    // Optically, this icon looks...off in our iOS native mobile app. Presumably
                                    // everywhere in Safari. If only we had a `clientInfo.isWebKit` test.
                                    transform:
                                        clientInfo.isNativeMobile && clientInfo.isAppleDevice
                                            ? "translateY(0.5px)"
                                            : undefined,
                                }}
                            />
                        </IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
