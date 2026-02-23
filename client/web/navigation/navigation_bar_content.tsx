import {ArrowLeft, DotsThreeVertical, Globe, Lock, X} from "phosphor-react";
import {
    ReactNode,
    Ref,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {addContextMenuActions} from "~/client/web/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Menu, MenuAction, MenuActions} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarActionsFlexBasis,
    navigationBarDoneButtonActionFlexBasis,
    navigationBarDoneButtonActionSpacerWidth,
    navigationBarDoneButtonActionWidth,
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useIsTextInputFocused} from "~/client/web/design/use_is_text_input_focused.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {BuildingsIcon} from "~/client/web/icons/buildings_icon.js";
import {defaultAccessLevelText} from "~/client/web/navigation/access_level_text.js";
import {ShareMobileModal} from "~/client/web/navigation/internal/share_mobile_modal.js";
import {ShareOverlay, ShareOverlayRef} from "~/client/web/navigation/internal/share_overlay.js";
import {ShareSwitch} from "~/client/web/navigation/internal/share_switch.js";
import {useShareState} from "~/client/web/navigation/internal/use_share_state.js";
import {NavigationBarShareButtonProps} from "~/client/web/navigation/navigation_bar_types.js";
import {useNavigationState} from "~/client/web/navigation/navigation_state_context.js";
import {ShareButton} from "~/client/web/navigation/share_button.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextIfExists} from "~/client/web/spaces/space_context.js";
import {pointerEventsNoneNotInheritedClassName} from "~/client/web/styles/styles.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    isSpacing,
    spacing,
} from "~/shared/design/core/spacing.js";
import {OutOfRangeError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

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
        menuOffset = defaultTooltipOffset,
        contextMenuExtraBottom,
        contextMenuActions = emptyArray,
        shareButton,
        withWideRouteLayoutShareMenuItem,
        replaceActions,
        titleJustifyContent,
        desktopControls,
        desktopMaxWidth: desktopMaxWidthProp,
        desktopTitleMaxWidth: desktopTitleMaxWidthProp,
        desktopTitleMaxWidthCenterOffset: desktopTitleMaxWidthCenterOffsetProp,
        desktopTitleFontSize = "200",
        desktopTitleFontWeight = "semi-bold",
        desktopTitleLeftSlop,
        desktopAdditionalActions,
        withoutMobileBackButton = false,
        defaultPreviousRoute,
        onMobileClose,
        onMobileCancel,
    }: {
        title?: ReactNode;
        withDisappearingTitle?: boolean;
        withoutFocusedTextInputDoneButton?: boolean;
        subtitle?: ReactNode;
        menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
        menuOffset?: Spacing;
        contextMenuExtraBottom?: ReactNode;
        contextMenuActions?: ReadonlyArray<ReadonlyArray<MenuAction>>;
        shareButton?: NavigationBarShareButtonProps;
        withWideRouteLayoutShareMenuItem?: boolean;
        replaceActions?: ReactNode;
        titleJustifyContent?: "center" | "flex-start";
        desktopControls?: ReactNode;
        desktopMaxWidth?: Spacing | RemLength;
        desktopTitleMaxWidth?: Spacing | RemLength;
        desktopTitleMaxWidthCenterOffset?: Spacing | RemLength;
        desktopTitleFontSize?: FontSize;
        desktopTitleFontWeight?: "semi-bold" | "bold";
        desktopTitleLeftSlop?: Spacing;
        desktopAdditionalActions?: ReactNode;
        withoutMobileBackButton?: boolean;
        defaultPreviousRoute?: MaybeThunk<string>;
        onMobileClose?: () => void;
        onMobileCancel?: () => void;
    },
    ref: Ref<NavigationBarContentRef>,
) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {isNativeMobile} = useClientInfo();
    const navigate = useNavigate();
    const spaceContext = useSpaceContextIfExists();
    const navigationState = useNavigationState();

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

    const hasLeftActions: boolean =
        isMobile && (!!onMobileClose || !!onMobileCancel || !withoutMobileBackButton);

    const hasRightActions: boolean =
        !!replaceActions || !!shareButton || isTextInputFocused || menuActions.length > 0;

    const handleBackButtonPress = () => {
        if (navigationState.hasPreviousLocation) {
            navigate(-1);
        } else if (defaultPreviousRoute) {
            if (typeof defaultPreviousRoute === "function") {
                void navigate(defaultPreviousRoute());
            } else {
                void navigate(defaultPreviousRoute);
            }
        } else {
            throw new OutOfRangeError("No previous page in browser history");
        }
    };

    return (
        <Box
            ref={contentRef}
            data-testid="NavigationBar"
            // Override `pointerEvents="none"` of parent in `navigation_bar_internal.tsx`.
            pointerEvents="auto"
            position="relative"
            zIndex="0"
            flexShrink="0"
            width="full"
            height={navigationBarHeight}
            display="flex"
            gap={!isMobile ? "5" : undefined}
            style={{
                maxWidth: !isMobile ? desktopMaxWidth : undefined,
                margin: !isMobile ? "0 auto" : undefined,
            }}
            onContextMenu={event => {
                if (contextMenuActions !== undefined && contextMenuActions.length > 0) {
                    addContextMenuActions(event.nativeEvent, contextMenuActions);
                }
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
                              {onMobileClose ? (
                                  <IconButton
                                      size="base"
                                      description="Close"
                                      withoutTooltip={true}
                                      pressErrorTitle="Couldn&#x2019;t close"
                                      onPress={onMobileClose}
                                  >
                                      <X />
                                  </IconButton>
                              ) : onMobileCancel ? (
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
                                          pressErrorTitle="Couldn&#x2019;t cancel"
                                          onPress={onMobileCancel}
                                      >
                                          Cancel
                                      </Button>
                                  </Box>
                              ) : (
                                  !withoutMobileBackButton &&
                                  // Don't show the back button if the actor doesn't have space access. If the
                                  // actor doesn't have space access they're probably looking at a shared URL in
                                  // their web browser. So they're not in an application context. A back button
                                  // doesn't make sense in a non-application context.
                                  //
                                  // TODO(calebmer): Maybe put an Alpine logo here instead? When `currentAccount`
                                  // does not exist. Or put the space logo.
                                  (spaceContext?.currentAccount || isNativeMobile) && (
                                      <IconButton
                                          size="base"
                                          description="Go back"
                                          withoutTooltip={true}
                                          pressErrorTitle="Couldn&#x2019;t go back"
                                          onPress={handleBackButtonPress}
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
                                // eslint-disable-next-line cyberworlds/string-quotes
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
                                    // eslint-disable-next-line cyberworlds/string-quotes
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
                                {desktopAdditionalActions && platform === "desktop" && (
                                    <Box paddingRight="4">{desktopAdditionalActions}</Box>
                                )}
                                {shareButton &&
                                    !withWideRouteLayoutShareMenuItem &&
                                    routeLayout === "wide" && (
                                        <Box paddingRight="4">
                                            <ShareButton
                                                entityNoun={shareButton.entityNoun}
                                                entityId={shareButton.entityId}
                                                isReadOnly={shareButton.isReadOnly}
                                                accessPolicy={shareButton.accessPolicy}
                                                onAccessPolicyChange={
                                                    shareButton.onAccessPolicyChange
                                                }
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
                                    (menuActions.length > 0 ||
                                        (shareButton &&
                                            (routeLayout !== "wide" ||
                                                withWideRouteLayoutShareMenuItem))) && (
                                        // We re-create `<MenuButton>` in this file since when clicking on the share
                                        // option we want to dynamically switch the menu for the `<ShareOverlay>`.
                                        <NavigationBarContentMoreButton
                                            menuActions={menuActions}
                                            menuOffset={menuOffset}
                                            extraBottom={contextMenuExtraBottom}
                                            shareButton={
                                                routeLayout !== "wide" ||
                                                withWideRouteLayoutShareMenuItem
                                                    ? shareButton
                                                    : undefined
                                            }
                                        />
                                    )
                                )}
                            </>
                        )}
                    </Box>
                )}
            </OverlayScopeContextProvider>
        </Box>
    );
});

function NavigationBarContentMoreButton({
    menuActions,
    menuOffset,
    extraBottom,
    shareButton,
}: {
    menuActions: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
    menuOffset: Spacing;
    extraBottom: ReactNode;
    shareButton: NavigationBarShareButtonProps | undefined;
}) {
    const platform = usePlatform();

    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<ShareOverlayRef>(null);

    const [showShareDesktopOverlay, setShowShareDesktopOverlay] = useState(false);
    if (!shareButton && showShareDesktopOverlay) setShowShareDesktopOverlay(false);
    if (platform !== "desktop" && showShareDesktopOverlay) setShowShareDesktopOverlay(false);

    const [showShareMobileModal, setShowShareMobileModal] = useState(false);
    if (!shareButton && showShareMobileModal) setShowShareMobileModal(false);
    if (platform !== "mobile" && showShareMobileModal) setShowShareMobileModal(false);

    const lastShowShareOverlayRef = useRef(showShareDesktopOverlay);

    // When `<OverlayTriggerButton>` opens an overlay, it moves focus into the
    // first focusable element of the overlay. Recreate this behavior when
    // switching from `showShareOverlay` false to true.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastShowShareOverlayRef.current === showShareDesktopOverlay) return;
        lastShowShareOverlayRef.current = showShareDesktopOverlay;

        if (!showShareDesktopOverlay) return;

        const overlayElement = overlayContainerRef.current;
        if (!overlayElement) return;

        getNextFocusableElementIfExists(null, {
            withinElement: overlayElement,
        })?.focus({preventScroll: true});
    }, [showShareDesktopOverlay]);

    const shareState = useShareState(
        shareButton
            ? {
                  entityNoun: shareButton.entityNoun,
                  accessLevelText: shareButton.accessLevelText ?? defaultAccessLevelText,
                  accessPolicy: shareButton.accessPolicy,
                  onAccessPolicyChangeWithoutValidations: shareButton.onAccessPolicyChange,
                  isReadOnly: shareButton.isReadOnly,
              }
            : null,
    );

    return (
        <>
            <OverlayTriggerButton
                aria-haspopup="menu"
                placement="bottom-end"
                offset={menuOffset}
                onActuallyVisibleChange={isActuallyVisible => {
                    if (!isActuallyVisible) setShowShareDesktopOverlay(false);
                }}
                overlay={({isVisible, onCloseWithAnimation, onCloseWithoutAnimation}) => (
                    <Box ref={overlayContainerRef}>
                        {showShareDesktopOverlay && shareButton ? (
                            <ShareOverlay
                                ref={overlayRef}
                                id={shareState.modalOwnerId}
                                entityId={shareButton.entityId}
                                accessLevelText={
                                    shareButton.accessLevelText ?? defaultAccessLevelText
                                }
                                accessPolicy={shareButton.accessPolicy}
                                onAccessPolicyChange={shareState.changeAccessPolicy}
                                isVisible={isVisible}
                                isReadOnly={shareState.isReadOnly}
                                onCopyLink={shareButton.onCopyLink}
                                onCloseWithoutAnimation={onCloseWithoutAnimation}
                            />
                        ) : (
                            <Menu
                                placement="bottom-end"
                                onCloseWithAnimation={onCloseWithAnimation}
                                onCloseWithoutAnimation={onCloseWithoutAnimation}
                                actions={
                                    shareButton
                                        ? addShareMenuItem({
                                              platform,
                                              shareButton,
                                              actions: menuActions,
                                              onShare: () => {
                                                  if (platform === "desktop") {
                                                      setShowShareDesktopOverlay(true);
                                                      return {withoutClose: true};
                                                  } else {
                                                      setShowShareMobileModal(true);
                                                  }
                                              },
                                          })
                                        : menuActions
                                }
                                extraBottom={extraBottom}
                            />
                        )}
                    </Box>
                )}
                onOverlayEscapeGlobalKeyDown={event => {
                    if (!showShareDesktopOverlay) return;

                    // If the focused element is a combobox input, `<MenuButton>`, or menu item
                    // that's open and the user hits escape then we want the escape keydown to close
                    // the focused element's overlay.
                    if (
                        event.target instanceof HTMLElement &&
                        (event.target.getAttribute("aria-expanded") === "true" ||
                            event.target.role === "menuitem")
                    ) {
                        return {allowDefault: true};
                    }
                }}
                onOverlayTabGlobalKeyDown={() => {
                    if (!showShareDesktopOverlay) return;

                    // Don't close the overlay when tab is pressed. Tab is needed to navigate
                    // internally within the share overlay.
                    return {allowDefault: true};
                }}
                onOverlayOutsidePress={() => {
                    if (!showShareDesktopOverlay || !shareButton) return;

                    const overlay = assertExists(overlayRef.current);

                    // If the share overlay's account grant input combobox is open and the user
                    // clicks outside of the overlay, instead of closing the entire overlay just
                    // close the combobox. A second click will close the overlay too.
                    if (overlay.isAccountGrantInputComboBoxOpen()) {
                        overlay.closeAccountGrantInputComboBox();
                        return {preventDefault: true};
                    }
                }}
            >
                <IconButton
                    size={platform === "mobile" ? "base" : "md"}
                    description="More"
                    withoutTooltip={true}
                    // Don't focus the button on press since pressing will open the overlay and
                    // should focus the overlay.
                    //
                    // TODO(calebmer): Find a way to automate this instead of setting this prop
                    // manually on every `<Button>` wrapped in an `<OverlayTriggerButton>`.
                    withoutFocusOnPress={true}
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
            </OverlayTriggerButton>
            {!(shareButton && showShareMobileModal) ? (
                shareState.modals
            ) : (
                <MobileFullScreenModal onClose={() => setShowShareMobileModal(false)}>
                    {({onCloseWithAnimation}) => (
                        <>
                            {shareState.modals}
                            <ShareMobileModal
                                entityNoun={shareButton.entityNoun}
                                accessLevelText={
                                    shareButton.accessLevelText ?? defaultAccessLevelText
                                }
                                accessPolicy={shareButton.accessPolicy}
                                onAccessPolicyChange={shareState.changeAccessPolicy}
                                isReadOnly={shareState.isReadOnly}
                                onCloseWithAnimation={onCloseWithAnimation}
                            />
                        </>
                    )}
                </MobileFullScreenModal>
            )}
        </>
    );
}

function isCopyLinkAction(action: MenuAction | undefined): boolean {
    return (
        action !== undefined &&
        "label" in action &&
        !("withCustomLayout" in action && action.withCustomLayout) &&
        action.label === "Copy link"
    );
}

function mergeCopyLinkSection(
    shareMenuItem: MenuAction,
    copyLinkActions: ReadonlyArray<MenuAction>,
    remainingActions: MenuActions,
): MenuActions {
    return [[shareMenuItem, ...copyLinkActions], ...remainingActions];
}

function addShareMenuItem({
    platform,
    shareButton,
    actions,
    onShare,
}: {
    platform: Platform;
    shareButton: NavigationBarShareButtonProps;
    actions: MenuActions;
    onShare: () => {withoutClose: boolean} | void;
}): MenuActions {
    const shareMenuItem = createShareMenuItem({platform, shareButton, onShare});

    // Merge with the "Copy link" section on mobile. But on desktop where the
    // switch is a part of the menu item, the share menu item needs a divider
    // to make it feel separate.
    const firstSection = actions[0];
    if (platform !== "desktop" && firstSection) {
        // Check if the first section is a readonly array (MenuAction[])
        if (isReadonlyArray(firstSection)) {
            if (isCopyLinkAction(firstSection[0])) {
                return mergeCopyLinkSection(shareMenuItem, firstSection, actions.slice(1));
            }
        } else if ("actions" in firstSection) {
            // This is a subsection, extract the actions and check the first one
            const sectionActions = firstSection.actions;
            if (Array.isArray(sectionActions) && isCopyLinkAction(sectionActions[0])) {
                return mergeCopyLinkSection(shareMenuItem, sectionActions, actions.slice(1));
            }
        } else if (isCopyLinkAction(firstSection)) {
            // Otherwise it's a single MenuAction
            return mergeCopyLinkSection(shareMenuItem, [firstSection], actions.slice(1));
        }
    }

    return [[shareMenuItem], ...actions];
}

function createShareMenuItem({
    platform,
    shareButton,
    onShare,
}: {
    platform: Platform;
    shareButton: NavigationBarShareButtonProps;
    onShare: () => {withoutClose: boolean} | void;
}): MenuAction {
    return {
        label: "Share",
        icon:
            platform !== "desktop" ? (
                shareButton.accessPolicy.urlGrant ? (
                    <Globe />
                ) : shareButton.accessPolicy.defaultGrant ? (
                    <BuildingsIcon />
                ) : (
                    <Lock />
                )
            ) : undefined,
        iconPlacement: "end",
        pressErrorTitle: "Couldn\u2019t share",
        onPress: onShare,
        extraActions:
            platform === "desktop" ? (
                <NavigationBarContentShareMenuItemSwitch shareButton={shareButton} />
            ) : undefined,
    };
}

function NavigationBarContentShareMenuItemSwitch({
    shareButton,
}: {
    shareButton: NavigationBarShareButtonProps;
}) {
    const {isReadOnly, changeAccessPolicy, modalOwnerId, modals} = useShareState({
        entityNoun: shareButton.entityNoun,
        accessLevelText: shareButton.accessLevelText ?? defaultAccessLevelText,
        accessPolicy: shareButton.accessPolicy,
        onAccessPolicyChangeWithoutValidations: shareButton.onAccessPolicyChange,
    });

    return (
        <>
            {modals}
            <Box id={modalOwnerId} paddingX="0.5">
                <ShareSwitch
                    isReadOnly={isReadOnly}
                    entityNoun={shareButton.entityNoun}
                    accessPolicy={shareButton.accessPolicy}
                    onAccessPolicyChange={changeAccessPolicy}
                />
            </Box>
        </>
    );
}
