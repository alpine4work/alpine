import {ArrowLeft, DotsThreeVertical} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useCallback, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarActionsFlexBasis,
    navigationBarDoneButtonActionFlexBasis,
    navigationBarDoneButtonActionSpacerWidth,
    navigationBarDoneButtonActionWidth,
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/design/navigation_bar_helpers.js";
import {NavigationBarShareButtonProps} from "~/client/design/navigation_bar_types.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {OverlayTriggerButtonState} from "~/client/design/overlay_trigger_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {ShareButton} from "~/client/design/share_button.js";
import {addShareMenuItem} from "~/client/design/share_menu_item.js";
import {useIsTextInputFocused} from "~/client/design/use_is_text_input_focused.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {pointerEventsNoneNotInheritedClassName} from "~/client/styles/styles.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    isSpacing,
    spacing,
} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type NavigationBarContentRef = {
    getElement(): HTMLElement;
    getTitleElement(): HTMLElement;
    reconcileFocusedTextInputIfMobile(): void;
};

export const NavigationBarContent = forwardRef(function NavigationBarContent(
    {
        title,
        withDisappearingTitle = false,
        withoutFocusedTextInputDoneButton = false,
        subtitle,
        menuActions = emptyArray,
        onMenuStateChange,
        shareButton,
        replaceActions,
        extraIconButton,
        titleJustifyContent,
        desktopControls,
        desktopMaxWidth: desktopMaxWidthProp,
        desktopTitleMaxWidth: desktopTitleMaxWidthProp,
        desktopTitleMaxWidthCenterOffset: desktopTitleMaxWidthCenterOffsetProp,
        desktopTitleFontSize = "200",
        desktopTitleFontWeight = "semi-bold",
        desktopTitleLeftSlop,
        withoutMobileBackButton = false,
        onMobileCancel,
    }: {
        title?: ReactNode;
        withDisappearingTitle?: boolean;
        withoutFocusedTextInputDoneButton?: boolean;
        subtitle?: ReactNode;
        menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
        onMenuStateChange?: (state: OverlayTriggerButtonState) => void;
        shareButton?: NavigationBarShareButtonProps;
        replaceActions?: ReactNode;
        extraIconButton?: {
            icon: ReactNode;
            pressErrorTitle: string;
            description: string;
            onPress: () => Promise<void>;
        };
        titleJustifyContent?: "center" | "flex-start";
        desktopControls?: ReactNode;
        desktopMaxWidth?: Spacing | RemLength;
        desktopTitleMaxWidth?: Spacing | RemLength;
        desktopTitleMaxWidthCenterOffset?: Spacing | RemLength;
        desktopTitleFontSize?: FontSize;
        desktopTitleFontWeight?: "semi-bold" | "bold";
        desktopTitleLeftSlop?: Spacing;
        withoutMobileBackButton?: boolean;
        onMobileCancel?: () => void;
    },
    ref: Ref<NavigationBarContentRef>,
) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {isNativeMobile} = useClientInfo();
    const navigate = useNavigate();
    const reporter = useReporter();

    const isMobile = platform === "mobile";

    titleJustifyContent ??= isMobile ? "center" : "flex-start";

    const contentRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLDivElement>(null);

    const {isTextInputFocused, reconcileFocusedTextInput} = useIsTextInputFocused({
        // Don't show done button on web mobile, only native mobile. Web mobile (e.g.
        // Safari) renders an accessory view with the input that comes with a done
        // button.
        isDisabled: !isMobile || !isNativeMobile || withoutFocusedTextInputDoneButton,

        ignore: useCallback((element: Element) => {
            // Don't show "Done" button if the focused text input has a popup
            // (`role="combobox"` [implicitly has `aria-haspopup="listbox"`][1]). These
            // inputs come with an overlay and so dismissing the input means clicking
            // outside of the overlay. Since the interaction for dismissing the keyboard
            // for the input is obvious we don't show a "Done" button. Also because often
            // autocomplete inputs have a blocking cover (they set `isBlocking={true}` on
            // their `<Overlay>`) you wouldn't be able to interact with the "Done" button
            // anyway.
            //
            // We added this for the assignee task filter on mobile (and the collection
            // task filter). It has a search input in a blocking overlay. We don't want to
            // show the "Done" button while the search input is focused. We also want this
            // to apply to inputs like `<TaskAssigneeInput>` in a detail view.
            //
            // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
            const ariaHasPopup =
                element.ariaHasPopup ?? (element.role === "combobox" ? "listbox" : null);
            return ariaHasPopup !== null;
        }, []),
    });

    useImperativeHandle(
        ref,
        () => ({
            getElement: () => assertExists(contentRef.current),
            getTitleElement: () => assertExists(titleRef.current),
            reconcileFocusedTextInputIfMobile: reconcileFocusedTextInput,
        }),
        [reconcileFocusedTextInput],
    );

    const desktopMaxWidth =
        desktopMaxWidthProp !== undefined
            ? isSpacing(desktopMaxWidthProp)
                ? spacing[desktopMaxWidthProp]
                : desktopMaxWidthProp
            : undefined;

    const desktopTitleMaxWidth =
        desktopTitleMaxWidthProp !== undefined
            ? isSpacing(desktopTitleMaxWidthProp)
                ? spacing[desktopTitleMaxWidthProp]
                : desktopTitleMaxWidthProp
            : undefined;

    const desktopTitleMaxWidthCenterOffset =
        desktopTitleMaxWidthCenterOffsetProp !== undefined
            ? isSpacing(desktopTitleMaxWidthCenterOffsetProp)
                ? spacing[desktopTitleMaxWidthCenterOffsetProp]
                : desktopTitleMaxWidthCenterOffsetProp
            : undefined;

    const hasLeftActions: boolean = isMobile && (!!onMobileCancel || !withoutMobileBackButton);

    const hasRightActions: boolean =
        !!replaceActions ||
        !!shareButton ||
        isTextInputFocused ||
        menuActions.length > 0 ||
        !!extraIconButton;

    return (
        <Box
            ref={contentRef}
            // Override `pointerEvents="none"` of parent in `navigation_bar_internal.tsx`.
            pointerEvents="auto"
            position="relative"
            zIndex="0"
            width="full"
            height={navigationBarHeight}
            display="flex"
            gap={!isMobile ? "5" : undefined}
            style={{
                maxWidth: !isMobile ? desktopMaxWidth : undefined,
                margin: !isMobile ? "0 auto" : undefined,
            }}
        >
            <OverlayScopeContextProvider>
                {isMobile
                    ? (hasLeftActions || hasRightActions) && (
                          <Box
                              flexShrink="0"
                              height={navigationBarHeight}
                              paddingLeft={navigationBarMobileGap}
                              display="flex"
                              justifyContent="flex-start"
                              alignItems="center"
                              style={{flexBasis: spacing[navigationBarActionsFlexBasis]}}
                          >
                              {onMobileCancel ? (
                                  <Box
                                      display="flex"
                                      justifyContent="flex-start"
                                      style={{
                                          width: mobileNavigationBarActionsWidthFittingFlexBasis,
                                      }}
                                  >
                                      <Button
                                          paddingX="2"
                                          fontSize="100"
                                          pressErrorTitle="Couldn’t cancel"
                                          onPress={onMobileCancel}
                                      >
                                          Cancel
                                      </Button>
                                  </Box>
                              ) : (
                                  !withoutMobileBackButton && (
                                      <IconButton
                                          size="base"
                                          description="Go back"
                                          withoutTooltip={true}
                                          pressErrorTitle="Couldn’t go back"
                                          onPress={() => navigate(-1)}
                                      >
                                          <ArrowLeft />
                                      </IconButton>
                                  )
                              )}
                          </Box>
                      )
                    : desktopTitleMaxWidth !== undefined && (
                          <Box
                              flexGrow="0"
                              flexShrink="0"
                              style={{
                                  width: `max(0px, 50% - ${
                                      desktopTitleMaxWidthCenterOffset !== undefined
                                          ? addRemLengths(
                                                desktopTitleMaxWidth,
                                                desktopTitleMaxWidthCenterOffset,
                                            )
                                          : desktopTitleMaxWidth
                                  } / 2)`,
                              }}
                          />
                      )}
                {titleJustifyContent === "center" && !replaceActions && isTextInputFocused && (
                    // This spacer keeps the title centered when the done button is visible if the
                    // title is small enough to still fit in the center. If the title is longer then
                    // this spacer will shrink to give the title space.
                    <Box
                        style={{
                            flexShrink: 1000,
                            width: navigationBarDoneButtonActionSpacerWidth,
                        }}
                    />
                )}
                <Box
                    flexGrow="1"
                    flexShrink="1"
                    height={navigationBarHeight}
                    paddingX={isMobile ? navigationBarMobileGap : undefined}
                    paddingLeft={
                        desktopTitleMaxWidth === undefined &&
                        !isMobile &&
                        titleJustifyContent !== "center"
                            ? "5"
                            : undefined
                    }
                    display="flex"
                    justifyContent={titleJustifyContent}
                    alignItems="center"
                    gap="3"
                    style={{
                        maxWidth: !isMobile ? desktopTitleMaxWidth : undefined,
                        // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                        // have `min-width: auto` which extends with content.
                        // https://stackoverflow.com/a/66689926/1568890
                        minWidth: 0,
                    }}
                >
                    {!isMobile && desktopControls && <Box>{desktopControls}</Box>}
                    <Box
                        ref={titleRef}
                        overflow="hidden"
                        // Initial opacity is 0. Our code will update the opacity.
                        opacity={withDisappearingTitle ? "0" : undefined}
                        // Initial pointer events is auto. Our code will update this style.
                        pointerEvents={!withDisappearingTitle ? "auto" : undefined}
                        paddingLeft={
                            !isMobile && desktopTitleLeftSlop !== undefined
                                ? desktopTitleLeftSlop
                                : undefined
                        }
                        marginLeft={
                            !isMobile && desktopTitleLeftSlop !== undefined
                                ? `-${desktopTitleLeftSlop}`
                                : undefined
                        }
                    >
                        <Box
                            overflow="hidden"
                            // We have less space on mobile so use a smaller font size.
                            fontSize={isMobile ? "100" : desktopTitleFontSize}
                            fontStyle={
                                isMobile
                                    ? "truncate-semi-bold"
                                    : `truncate-${desktopTitleFontWeight}`
                            }
                            userSelect={!isMobile ? "text" : undefined}
                            paddingLeft={
                                !isMobile && desktopTitleLeftSlop !== undefined
                                    ? desktopTitleLeftSlop
                                    : undefined
                            }
                            marginLeft={
                                !isMobile && desktopTitleLeftSlop !== undefined
                                    ? `-${desktopTitleLeftSlop}`
                                    : undefined
                            }
                            textAlign={
                                subtitle && (isMobile || titleJustifyContent === "center")
                                    ? "center"
                                    : undefined
                            }
                            style={{
                                // Render contextual alternate glyphs. User text may be rendered here. Helpful
                                // for consistency if the user types anything like 2x2 or an @ mention.
                                fontFeatureSettings: '"calt" on',
                            }}
                        >
                            {title}
                        </Box>
                        {subtitle && (
                            <Box
                                fontSize="50"
                                color="grey-50"
                                fontStyle="truncate"
                                userSelect={!isMobile ? "text" : undefined}
                                textAlign={isMobile ? "center" : "left"}
                                style={{
                                    // Render contextual alternate glyphs. User text may be rendered here. Helpful
                                    // for consistency if the user types anything like 2x2 or an @ mention.
                                    fontFeatureSettings: '"calt" on',
                                }}
                            >
                                {subtitle}
                            </Box>
                        )}
                    </Box>
                </Box>
                {(hasLeftActions || hasRightActions) && (
                    <Box
                        flexGrow={!isMobile ? "1" : undefined}
                        flexShrink="0"
                        height={navigationBarHeight}
                        paddingRight={isMobile ? navigationBarMobileGap : "5"}
                        display="flex"
                        justifyContent="flex-end"
                        alignItems="center"
                        gap="1"
                        // Gives children `pointer-events: initial` so the user can interact with them.
                        className={pointerEventsNoneNotInheritedClassName}
                        style={{
                            flexBasis:
                                !replaceActions && isTextInputFocused
                                    ? spacing[navigationBarDoneButtonActionFlexBasis]
                                    : spacing[navigationBarActionsFlexBasis],
                        }}
                    >
                        {replaceActions ? (
                            replaceActions
                        ) : (
                            <>
                                {shareButton && routeLayout !== "narrow" && (
                                    <Box paddingRight="4">
                                        <ShareButton
                                            accessPolicy={shareButton.accessPolicy}
                                            onAccessPolicyChange={shareButton.onAccessPolicyChange}
                                            onCopyLink={shareButton.onCopyLink}
                                        />
                                    </Box>
                                )}
                                {isTextInputFocused ? (
                                    // If a text input is focused then we hide menu actions and replace it with a
                                    // "Done" button. This helps the user see how to end their editing session.
                                    // Opening menu actions would cause the text input to unfocus anyway.
                                    <Box
                                        display="flex"
                                        justifyContent="flex-end"
                                        style={{width: navigationBarDoneButtonActionWidth}}
                                    >
                                        <Button
                                            fontSize="100"
                                            // Don't remove focus from the current text input element
                                            // on press start. Remove focus on press finish.
                                            isFocusable={false}
                                            onPress={() => {
                                                if (document.activeElement instanceof HTMLElement) {
                                                    document.activeElement.blur();
                                                }
                                            }}
                                        >
                                            <Box display="inline" fontStyle="semi-bold">
                                                Done
                                            </Box>
                                        </Button>
                                    </Box>
                                ) : (
                                    <>
                                        {extraIconButton && (
                                            <IconButton
                                                description={extraIconButton.description}
                                                size={isMobile ? "base" : "md"}
                                                pressErrorTitle={extraIconButton.pressErrorTitle}
                                                withoutTooltip={true}
                                                onPress={extraIconButton.onPress}
                                            >
                                                {extraIconButton.icon}
                                            </IconButton>
                                        )}
                                        {(menuActions.length > 0 ||
                                            (shareButton && routeLayout === "narrow")) && (
                                            <MenuButton
                                                placement="bottom-end"
                                                actions={
                                                    shareButton && routeLayout === "narrow"
                                                        ? addShareMenuItem(reporter, menuActions)
                                                        : menuActions
                                                }
                                                onStateChange={onMenuStateChange}
                                            >
                                                <IconButton
                                                    size={isMobile ? "base" : "md"}
                                                    description="More"
                                                    withoutTooltip={true}
                                                >
                                                    <DotsThreeVertical
                                                    // Vertical dots create better visual balance on mobile because:
                                                    //
                                                    // 1. On mobile we have a back button on the left and we want this button to
                                                    //    look aligned with that
                                                    // 2. The title might be truncated with ellipsis which looks like horizontal
                                                    //    dots
                                                    />
                                                </IconButton>
                                            </MenuButton>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                )}
            </OverlayScopeContextProvider>
        </Box>
    );
});
