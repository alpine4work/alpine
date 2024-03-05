import {animate} from "motion";
import {
    At,
    ChatCircleText,
    DotsThreeVertical,
    IconContext,
    ListBullets,
    ListChecks,
    ListNumbers,
    TextBolder,
    TextIndent,
    TextItalic,
    TextOutdent,
} from "phosphor-react";
import {Command, EditorState, Selection} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    Dispatch,
    ReactNode,
    RefObject,
    SetStateAction,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {ContentEditorMobileCommentInputBottomBar} from "~/client/content/internal/content_editor_mobile_comment_input_bottom_bar.js";
import {
    ContentEditorMobileKeyboardSubstitute,
    ContentEditorMobileKeyboardSubstituteRef,
} from "~/client/content/internal/content_editor_mobile_keyboard_substitute.js";
import {
    ContentEditorMobileLinkModal,
    ContentEditorMobileLinkModalState,
} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {openMentionFloaterMetaKey} from "~/client/content/internal/content_editor_plugin_input_rules.js";
import {areAllNodesListItemType} from "~/client/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {createToggleMarkCommand} from "~/client/content/internal/helpers/create_toggle_mark_command.js";
import {expandEmptySelectionAroundWord} from "~/client/content/internal/helpers/expand_empty_selection_around_word.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/content/internal/helpers/indent_and_dedent_list_item_commands.js";
import {Box} from "~/client/design/box.js";
import {MobileModal} from "~/client/design/mobile_modal.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/mobile_bottom_bar.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";
import {registerMobileBottomBarKeyboardToolbar} from "~/client/remix/subscribe_to_mobile_keyboard_frame_change.js";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";

// NOCOMMIT: Haptic feedback when style is selected? This feels like a nice way
// to reward.

export function ContentEditorMobileKeyboardToolbar({
    state,
    viewRef,
    isFocused,
    setDecorationCallbacks,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    isFocused: boolean;
    setDecorationCallbacks: Dispatch<
        SetStateAction<
            ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
        >
    >;
}) {
    const {schema} = state.doc.type;

    const isMounted = useIsMounted();
    const {isNativeMobile} = useClientInfo();

    const toolbarRef = useRef<HTMLDivElement>(null);
    const substituteRef = useRef<ContentEditorMobileKeyboardSubstituteRef>(null);
    const id = useId();

    const [isSubstituteOpen, setIsSubstituteOpen] = useState(false);
    const [isCommentInputOpen, setIsCommentInputOpen] = useState(false);
    const [linkModalState, setLinkModalState] = useState<ContentEditorMobileLinkModalState | null>(
        null,
    );

    useEffect(() => {
        if (!isFocused && isSubstituteOpen) {
            const substitute = assertExists(substituteRef.current);
            substitute.closeWithAnimation();
        }
    }, [isSubstituteOpen, isFocused]);

    // If we unmounted while the substitute is open then we need to run
    // `cleanupAfterSubstitute()`.
    useEffect(() => {
        return () => {
            if (!isMounted() && isSubstituteOpen) {
                void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
            }
        };
    }, [isSubstituteOpen, isMounted]);

    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInertNativeMobileRoute) return;
        return registerMobileBottomBarKeyboardToolbar();
    }, [isInertNativeMobileRoute]);

    const isFocusedRef = useRef(isFocused);
    useEffect(() => {
        // In our native mobile app, the native mobile wrapper is responsible for
        // making this toolbar visible.
        if (isNativeMobile) return;

        if (isFocusedRef.current === isFocused) return;
        isFocusedRef.current = isFocused;

        const toolbarElement = assertExists(toolbarRef.current);

        if (isFocused) {
            animate(
                toolbarElement,
                {
                    y: [0, `-${mobileBottomBarKeyboardToolbarHeightRem}rem`],
                },
                {
                    duration: 0.2,
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            );
        } else {
            animate(
                toolbarElement,
                {
                    y: [`-${mobileBottomBarKeyboardToolbarHeightRem}rem`, 0],
                },
                {
                    duration: 0.2,
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            );
        }
    }, [isFocused, isNativeMobile]);

    const wordSelectionIfEmpty = useMemo(
        () => expandEmptySelectionAroundWord(state.doc, state.selection),
        [state.doc, state.selection],
    );
    const setSelectionAfterCommentInputOpenRef = useRef<Selection | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isCommentInputOpen) return;

        const view = assertExists(viewRef.current);

        if (setSelectionAfterCommentInputOpenRef.current) {
            const selection = setSelectionAfterCommentInputOpenRef.current;
            setSelectionAfterCommentInputOpenRef.current = null;
            view.dispatch(view.state.tr.setSelection(selection));
        }

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(state.selection.from, state.selection.to, {
                    class: contentSchemaStyles.commentClassName,
                }),
            ]);
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [isCommentInputOpen, setDecorationCallbacks, viewRef]);

    const {isBoldActive, isItalicActive} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, state.selection);

        const boldMark = state.schema.mark("bold");
        const italicMark = state.schema.mark("italic");

        return {
            isBoldActive:
                boldMark.isInSet(marks) ||
                (!!state.storedMarks && boldMark.isInSet(state.storedMarks)),
            isItalicActive:
                italicMark.isInSet(marks) ||
                (!!state.storedMarks && italicMark.isInSet(state.storedMarks)),
        };
    }, [state.doc, state.schema, state.selection, state.storedMarks]);

    const isUnorderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(
                state.doc,
                state.selection,
                state.schema.nodes.unorderedListItem,
            ),
        [state.doc, state.schema.nodes.unorderedListItem, state.selection],
    );

    const isOrderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.orderedListItem),
        [state.doc, state.schema.nodes.orderedListItem, state.selection],
    );

    const isCheckListItemActive = useMemo(
        () =>
            !!state.schema.nodes.checkListItem &&
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.checkListItem),
        [state.doc, state.schema.nodes.checkListItem, state.selection],
    );

    const isIndentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive || isCheckListItemActive) &&
            indentListItemCommand(state),
        [isCheckListItemActive, isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    const isDedentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive || isCheckListItemActive) &&
            dedentListItemCommand(state),
        [isCheckListItemActive, isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    return (
        <>
            <Box
                ref={toolbarRef}
                id={isNativeMobile ? `nmbb-kt-${id}` : id}
                // NOTE(calebmer): This is a little strange, we have a wrapper `<div>` with
                // `spacing["2"]` padding height on our keyboard toolbar. I've observed this
                // makes the animation when the iOS keyboard opens more consistent. Before
                // adding this slop sometimes when animating the keyboard open the toolbar
                // wouldn't be visible until half way through the animation then pop in. This
                // looks janky. You can observe it in [this video][1] ([backup link][2]) if you
                // go frame by frame either time the keyboard opens. The toolbar pops in during
                // the animation. This doesn't happen all the time. It's sporadic, mostly
                // happening when the keyboard opens without needing to scroll the view.
                //
                // My theory is that somewhere iOS or Safari is un-rendering the element while
                // it's offscreen and since we start the animation through non-traditional
                // means (directly writing to Safari's `CALayer` transform property in native
                // code) it gets rendered during the animation not before it. I've found adding
                // this slop fixes the bug and makes the animation much more consistent. I
                // don't have a proven reason as to why but my theory is the slop tricks iOS or
                // Safari into thinking the toolbar is visible onscreen so needs to always be
                // rendered.
                //
                // [1]: https://gist.github.com/assets/8282507/3e2c58e3-d489-4e10-85d1-b0a7c4209e55
                // [2]: https://gist.github.com/calebmer/76c991e6e7c51459aaae1702306b0fa4
                pointerEvents="none"
                paddingTop="2"
                marginTop="-2"
                position="fixed"
                // Render above everything on the page
                zIndex="60"
                left="0"
                right="0"
                style={{
                    // `bottom: "-" + mobileBottomBarKeyboardToolbarHeightRem + "rem"` also
                    // works except for in our Safari app keyboard support which limits the outlet
                    // height to what's visible above the keyboard.
                    top: `var(--space-outlet-height, 100svh)`,
                    transition:
                        // Animate after `--space-outlet-height` changes when the keyboard opens in
                        // mobile Safari (not our native app). This is a little hacky. Ideally we'd run
                        // the animation in our effect again but this is simple and we don't care too
                        // much about mobile Safari (we care a lot about our native app).
                        isFocused && isMobileWebKit && !isNativeMobile
                            ? `top 400ms ease`
                            : undefined,
                    // Our native mobile wrapper looks for compositing layers created from an
                    // element with an ID that starts with `nmbb-` and ties their position to
                    // the tab bar and software keyboard. So we get smooth animations while the
                    // keyboard opens or the tab bar shifts offscreen. To create a compositing
                    // layer we need to set `will-change: transform`. It's not specified that
                    // `will-change: transform` MUST create a compositing layer, instead some
                    // browser engines implement this hint themselves as an optimization.
                    //
                    // It so happens that WebKit is one of those browsers. Here's the code in
                    // WebKit that does this: [part 1][1], [part 2][2].
                    //
                    // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                    // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                    willChange: isNativeMobile ? "transform" : undefined,
                    // Set `transform` to its initial value assuming the tab bar is up. Since this
                    // is a keyboard toolbar (configured with `kt-` in the ID) it doesn't move with
                    // the tab bar.
                    transform: isNativeMobile ? "translateY(0px)" : undefined,
                }}
                // Suppress React hydration warnings in our native mobile app. The native
                // mobile app sets the `transform` property on this element. Sometimes before
                // React finishes hydrating. This is expected, React can ignore the difference.
                suppressHydrationWarning={isNativeMobile ? true : undefined}
            >
                <Box
                    pointerEvents="auto"
                    height={mobileBottomBarKeyboardToolbarHeight}
                    backgroundColor="grey-5"
                    display="flex"
                    paddingX="0.5"
                    onPointerDownCapture={event => {
                        // Tapping on the toolbar shouldn't unfocus the content editor since that will
                        // remove the selection and hide the keyboard.
                        event.preventDefault();
                    }}
                >
                    <ContentEditorMobileKeyboardToolbarButton
                        label="Mention"
                        dividerRight
                        isActive={false}
                        onPress={() => {
                            const view = assertExists(viewRef.current);
                            const {state} = view;
                            const schema = state.doc.type.schema;

                            view.dispatch(
                                state.tr
                                    .replaceSelectionWith(schema.text("@"))
                                    .setMeta(openMentionFloaterMetaKey, true),
                            );
                        }}
                    >
                        <At />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton
                        label="Bold"
                        dividerLeft
                        isActive={isBoldActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("bold")),
                        )}
                    >
                        <TextBolder />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton
                        label="Italic"
                        dividerRight
                        isActive={isItalicActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("italic")),
                        )}
                    >
                        <TextItalic />
                    </ContentEditorMobileKeyboardToolbarButton>
                    {!isOrderedListItemActive && !isCheckListItemActive && (
                        <ContentEditorMobileKeyboardToolbarButton
                            label="Bullet list"
                            dividerLeft
                            isActive={isUnorderedListItemActive}
                            onPress={fromCommand(
                                viewRef,
                                createToggleListItemsCommand(state.schema.nodes.unorderedListItem),
                            )}
                        >
                            <ListBullets />
                        </ContentEditorMobileKeyboardToolbarButton>
                    )}
                    {!isUnorderedListItemActive && !isCheckListItemActive && (
                        <ContentEditorMobileKeyboardToolbarButton
                            label="Number list"
                            dividerLeft={isOrderedListItemActive}
                            dividerRight={!isOrderedListItemActive}
                            isActive={isOrderedListItemActive}
                            onPress={fromCommand(
                                viewRef,
                                createToggleListItemsCommand(state.schema.nodes.orderedListItem),
                            )}
                        >
                            <ListNumbers />
                        </ContentEditorMobileKeyboardToolbarButton>
                    )}
                    {state.schema.nodes.checkListItem && isCheckListItemActive && (
                        <ContentEditorMobileKeyboardToolbarButton
                            label="Check list"
                            dividerLeft
                            isActive={isCheckListItemActive}
                            onPress={fromCommand(
                                viewRef,
                                createToggleListItemsCommand(state.schema.nodes.checkListItem),
                            )}
                        >
                            <ListChecks />
                        </ContentEditorMobileKeyboardToolbarButton>
                    )}
                    {(isOrderedListItemActive ||
                        isUnorderedListItemActive ||
                        isCheckListItemActive) && (
                        <>
                            <ContentEditorMobileKeyboardToolbarButton
                                label="Dedent"
                                isActive={false}
                                isDisabled={!isDedentListItemEnabled}
                                onPress={fromCommand(viewRef, dedentListItemCommand)}
                            >
                                <TextOutdent />
                            </ContentEditorMobileKeyboardToolbarButton>
                            <ContentEditorMobileKeyboardToolbarButton
                                label="Indent"
                                dividerRight
                                isActive={false}
                                isDisabled={!isIndentListItemEnabled}
                                onPress={fromCommand(viewRef, indentListItemCommand)}
                            >
                                <TextIndent />
                            </ContentEditorMobileKeyboardToolbarButton>
                        </>
                    )}
                    <ContentEditorMobileKeyboardToolbarButton
                        label="Comment"
                        dividerLeft
                        isActive={false}
                        isDisabled={
                            state.selection.from === state.selection.to && !wordSelectionIfEmpty
                        }
                        onPress={() => {
                            // Set the selection after the comment input opens so the mobile selection
                            // renderer doesn't flash in/out.
                            if (wordSelectionIfEmpty) {
                                setSelectionAfterCommentInputOpenRef.current = wordSelectionIfEmpty;
                            }

                            setIsCommentInputOpen(true);
                        }}
                    >
                        <ChatCircleText />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton
                        label="More"
                        isActive={false}
                        onPress={() => {
                            if (!NativeMobileBridge) {
                                setIsSubstituteOpen(true);
                            } else {
                                NativeMobileBridge.keyboard.prepareForSubstitute().finally(() => {
                                    setIsSubstituteOpen(true);
                                });
                            }
                        }}
                    >
                        <DotsThreeVertical />
                    </ContentEditorMobileKeyboardToolbarButton>
                </Box>
            </Box>
            {isSubstituteOpen && (
                <ContentEditorMobileKeyboardSubstitute
                    ref={substituteRef}
                    state={state}
                    viewRef={viewRef}
                    onClose={() => {
                        setIsSubstituteOpen(false);
                        void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
                    }}
                    onLinkModalOpen={setLinkModalState}
                />
            )}
            {linkModalState && (
                <MobileModal onClose={() => setLinkModalState(null)}>
                    {({onCloseWithAnimation}) => (
                        <ContentEditorMobileLinkModal
                            viewRef={viewRef}
                            initialText={linkModalState.initialText}
                            isTextEditable={linkModalState.isTextEditable}
                            initialUrl={linkModalState.initialUrl}
                            onCloseWithAnimation={onCloseWithAnimation}
                        />
                    )}
                </MobileModal>
            )}
            {schema.marks.comment && isCommentInputOpen && (
                <ContentEditorMobileCommentInputBottomBar
                    onClose={() => setIsCommentInputOpen(false)}
                />
            )}
        </>
    );
}

function ContentEditorMobileKeyboardToolbarButton({
    label,
    children,
    dividerLeft,
    dividerRight,
    isActive,
    isDisabled,
    onPress,
}: {
    label: string;
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    isActive: boolean;
    isDisabled?: boolean;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({
        isDisabled,
        onPress,
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch
                    // and nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no
                // keyboard navigation.
                {...pressAndHoverProps}
                aria-label={label}
                flexGrow="1"
                height="full"
                paddingY="1"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="full"
                    height="full"
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-text" : "grey-70"}
                    backgroundColor={
                        isDisabled
                            ? undefined
                            : isPressedAndActive
                            ? "grey-20"
                            : isHovered && isPressed
                            ? "grey-20"
                            : isPressed || isActive || isHovered
                            ? "grey-10"
                            : undefined
                    }
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </Box>
            </Box>
            {dividerRight && (
                <Box
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                    paddingY="2"
                >
                    <Box height="full" borderRight="grey-10" />
                </Box>
            )}
        </>
    );
}

function fromCommand(viewRef: RefObject<EditorView | null>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };
}
