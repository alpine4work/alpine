import {useCallback, useEffect, useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getContentEditorScrollAnchorPosition} from "~/client/web/content/get_content_editor_scroll_anchor_position.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {ShareSwitchCreatorInput} from "~/client/web/navigation/share_switch_creator_input.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    useCurrentDate,
    useCurrentTimeRoundedToHour,
} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    channelCreatorDescriptionFieldMinHeightPx,
    channelCreatorDescriptionFieldPaddingX,
    channelCreatorDescriptionFieldPaddingY,
    channelCreatorFieldHelpMarginTop,
    channelCreatorGap,
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {createChannel} from "~/shared/rpc/forum_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function ChannelCreator({
    title,
    initiallyFocus,
    initialName,
    initialDescription,
}: {
    title: string;
    initiallyFocus: "Name" | "Description" | null;
    initialName: string;
    initialDescription: MessageContentWithReferences;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();
    const currentDate = useCurrentDate();
    const currentTime = useCurrentTimeRoundedToHour();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const descriptionEditorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: initialName,
        hasNameChanged: false,
    }));

    const [{descriptionState, hasDescriptionChanged}, setDescriptionState] = useState(() => ({
        descriptionState: ContentEditorState.create({
            spaceId: space.id,
            content: initialDescription,
            selection: "start",
        }),
        hasDescriptionChanged: false,
    }));

    const [isPublic, setIsPublic] = useState(true);

    const descriptionLabelId = useId();

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (initiallyFocus === null) return;

        const nameInputElement = assertExists(nameInputRef.current);
        const descriptionEditor = assertExists(descriptionEditorRef.current);

        return scheduleAfterNavigationAnimation(() => {
            switch (initiallyFocus) {
                case "Name": {
                    nameInputElement.focus();

                    nameInputElement.selectionStart = nameInputElement.selectionEnd =
                        nameInputElement.value.length;
                    break;
                }
                case "Description": {
                    descriptionEditor.focus();
                    break;
                }
                default:
                    throw exhaustive(initiallyFocus);
            }
        });
    }, [initiallyFocus]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title,
        withoutDisappearingTitle: true,
        desktopTitleFontSize: channelCreatorNavigationBarDesktopTitleFontSize,
        desktopTitleFontWeight: "bold",
        replaceActions: (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                <Button
                    ref={saveButtonRef}
                    variant="neutral"
                    fontSize="100"
                    isDisabled={
                        (!hasNameChanged && !hasDescriptionChanged) || name.trim().length === 0
                    }
                    pressErrorTitle="Couldn&#x2019;t save channel"
                    onPress={async () => {
                        if (isContentEmpty(descriptionState.getDoc()) && isPublic) {
                            await navigate(
                                `/channel/${generateId()}?create=${space.id}+${encodeURIComponent(name)}`,
                                {
                                    replace: true,
                                    // In our native mobile app, we want to call
                                    // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                    // push animation while replacing in the history stack.
                                    state: NativeMobileBridge
                                        ? {withPushAnimation: true}
                                        : undefined,
                                },
                            );
                        } else {
                            // It's slightly more efficient to create a channel with the `create` URL parameter
                            // because:
                            //
                            // 1. We don't need to read the channel back from DynamoDB in the loader since we
                            //    created the DynamoDB item in the loader.
                            //
                            // 2. We need to read the channel back from DynamoDB with strong read consistency
                            //    (which is more expensive than eventual consistency) or else we risk telling
                            //    the user the channel they just created doesn't exist.
                            //
                            // However, the `create` URL parameter doesn't support descriptions. We couldn't
                            // fit a long description into the URL. So if the user typed up a description we
                            // need to create the channel with an RPC then navigate to its URL.
                            const channel = await createChannel(context, {
                                spaceId: space.id,
                                name,
                                description: descriptionState.getDoc(),
                                accessPolicy: !isPublic
                                    ? {
                                          type: "Local",
                                          accountGrantById: new Map([
                                              [currentAccount.id, {level: "Manage", generation: 0}],
                                          ]),
                                          defaultGrant: null,
                                          urlGrant: null,
                                      }
                                    : undefined,
                            });

                            await navigate(`/channel/${channel.channelId}?consistency=strong`, {
                                replace: true,
                                // In our native mobile app, we want to call
                                // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                // push animation while replacing in the history stack.
                                state: NativeMobileBridge ? {withPushAnimation: true} : undefined,
                            });
                        }
                    }}
                >
                    Create
                </Button>
            </Box>
        ),
        defaultPreviousRoute: `/create/${space.id}`,
    });

    useScrollToAvoidBottomBarsAndMobileKeyboard(containerRef, {
        // Disable on `isInitialAppRender` since `coordsAtPos()` won't work on initial
        // render.
        isDisabled: isInitialAppRender,
        getAnchorPosition: useCallback(
            () => getContentEditorScrollAnchorPosition(descriptionEditorRef),
            [],
        ),
    });

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                containerRef,
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            overflowY="auto"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="relative"
                    paddingY="safe-area-inset"
                    width="full"
                    maxWidth={peekNarrowLayoutWidth}
                    marginX="auto"
                >
                    {navigationBar}
                    <Box height={navigationBarHeight} />
                    <Box
                        display="flex"
                        flexDirection="column"
                        gap={channelCreatorGap}
                        paddingTop={channelCreatorMarginTop}
                        paddingBottom="24"
                        paddingX={screenPaddingX}
                    >
                        <Box>
                            <TextInput
                                ref={nameInputRef}
                                maxLength={maxLabelStringLength}
                                fontSize="100"
                                label="Name"
                                placeholder="My Project"
                                value={name}
                                onChange={name => setNameState({name, hasNameChanged: true})}
                                onEnter={() => assertExists(saveButtonRef.current).press()}
                            />
                            <Box
                                paddingTop={channelCreatorFieldHelpMarginTop}
                                fontSize="50"
                                color="grey-50"
                                userSelect="text"
                            >
                                {/* NOTE(calebmer, 2025-05-06): This text is shamelessly copied from Slack's
                                create channel experience. Slack's help text here is perfect, I have no
                                notes. */}
                                Channels are where conversations happen around a topic. Use a name
                                that is easy to find and understand.
                            </Box>
                        </Box>
                        <Box>
                            <label
                                id={descriptionLabelId}
                                className={sprinkles({
                                    // `display: block; width: fit-content` is important here! As `inline-block`
                                    // there's some weird additional vertical space underneath the label.
                                    display: "block",
                                    width: "fit-content",
                                    maxWidth: "full",
                                    fontSize: "75",
                                    fontStyle: "semi-bold",
                                    paddingBottom: "1.5",
                                })}
                            >
                                Description
                            </label>
                            <FocusRing offset="border" isVisibleWhenFocusWithin>
                                <Box borderRadius="1" boxShadow="elevation-5-with-grey-10-border">
                                    <ContentEditor
                                        ref={descriptionEditorRef}
                                        aria-labelledby={descriptionLabelId}
                                        state={descriptionState}
                                        onChange={(state, transaction) => {
                                            setDescriptionState(({hasDescriptionChanged}) => ({
                                                descriptionState: state,
                                                hasDescriptionChanged:
                                                    hasDescriptionChanged || transaction.docChanged,
                                            }));
                                        }}
                                        className={sprinkles({
                                            paddingX: channelCreatorDescriptionFieldPaddingX,
                                            paddingY: channelCreatorDescriptionFieldPaddingY,
                                        })}
                                        style={{
                                            minHeight:
                                                channelCreatorDescriptionFieldMinHeightPx[
                                                    spacingScale
                                                ],
                                        }}
                                        // If the description is empty then we render a dummy placeholder to incentivize
                                        // adding a description to the channel.
                                        placeholder={`Created ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                                            clientInfo.locale,
                                            clientInfo.timeZone,
                                            currentDate,
                                            currentTime,
                                            {
                                                withLongMonth: true,
                                                withLongWeekday: true,
                                                withoutTime: true,
                                            },
                                        )}`}
                                        // Always in editing mode. User won't be reading while in the modal.
                                        withoutMobileDualModality={true}
                                    />
                                </Box>
                            </FocusRing>
                            <Box
                                paddingTop={channelCreatorFieldHelpMarginTop}
                                fontSize="50"
                                color="grey-50"
                                userSelect="text"
                            >
                                Use the description to provide more information about this channel.
                                Like what conversations someone should expect or some important
                                links.
                            </Box>
                        </Box>
                        <ShareSwitchCreatorInput
                            isPublic={isPublic}
                            onIsPublicChange={setIsPublic}
                        />
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
