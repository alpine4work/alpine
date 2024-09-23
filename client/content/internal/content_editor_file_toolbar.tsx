import {
    AlignCenterHorizontalSimple,
    AlignLeftSimple,
    AlignRightSimple,
    ChatCircleText,
    IconContext,
    UploadSimple,
} from "phosphor-react";
import {Command, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useRef} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {openCommentInputFloaterMetaKey} from "~/client/content/internal/build_content_editor_keymap_plugin.js";
import {Box} from "~/client/design/box.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {greyElevated2ClassName, sprinkles} from "~/client/styles/styles.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ContentEditorFileToolbar({
    state,
    viewRef,
    targetElement,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView>;
    targetElement: HTMLElement;
}) {
    return (
        <OverlayAnimated
            isVisible={true}
            disableAnimationOut={true}
            placement="top"
            // It doesn't make sense for the toolbar to flip. Since if it's over a range of
            // text it'll always be at the beginning of the text. Always make sure the
            // `<ContentEditor>` has some space above it so the toolbar will never go
            // offscreen.
            fallbackPlacements={emptyArray}
            offset="4"
            targetElement={targetElement}
            overlay={
                <Box
                    display="flex"
                    paddingLeft="1"
                    paddingRight="0.5"
                    color="grey-100"
                    backgroundColor="grey-0"
                    borderRadius="1.5"
                    boxShadow="elevation-20"
                    className={greyElevated2ClassName}
                >
                    <ContentEditorFileToolbarButton
                        description="Align left"
                        viewRef={viewRef}
                        isActive={false}
                        command={() => {
                            // TODO(calebmer, #files): Implement!
                            return false;
                        }}
                    >
                        <AlignLeftSimple />
                    </ContentEditorFileToolbarButton>
                    <ContentEditorFileToolbarButton
                        description="Align center"
                        viewRef={viewRef}
                        isActive={false}
                        command={() => {
                            // TODO(calebmer, #files): Implement!
                            return false;
                        }}
                    >
                        <AlignCenterHorizontalSimple />
                    </ContentEditorFileToolbarButton>
                    <ContentEditorFileToolbarButton
                        dividerRight={true}
                        description="Align right"
                        viewRef={viewRef}
                        isActive={false}
                        command={() => {
                            // TODO(calebmer, #files): Implement!
                            return false;
                        }}
                    >
                        <AlignRightSimple />
                    </ContentEditorFileToolbarButton>
                    <ContentEditorFileToolbarButton
                        dividerLeft={true}
                        dividerRight={!!state.schema.marks.comment}
                        description="Replace"
                        viewRef={viewRef}
                        isActive={false}
                        command={() => {
                            // TODO(calebmer, #files): Implement!
                            return false;
                        }}
                    >
                        <UploadSimple />
                    </ContentEditorFileToolbarButton>
                    {state.schema.marks.comment && (
                        <ContentEditorFileToolbarButton
                            dividerLeft={true}
                            // Intentionally not rendering keyboard shortcut since "Comment" is the only
                            // option that supports a keyboard shortcut. Only showing a keyboard shortcut
                            // on this one button's tooltip would look weird.
                            description="Comment"
                            viewRef={viewRef}
                            isActive={false}
                            command={(state, dispatch) => {
                                dispatch?.(state.tr.setMeta(openCommentInputFloaterMetaKey, true));
                                return true;
                            }}
                        >
                            <ChatCircleText />
                        </ContentEditorFileToolbarButton>
                    )}
                </Box>
            }
        />
    );
}

function ContentEditorFileToolbarButton({
    description,
    viewRef,
    isActive,
    command,
    children,
    dividerLeft,
    dividerRight,
}: {
    description: string;
    viewRef: RefObject<EditorView | null>;
    isActive: boolean;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const onPress = () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {pressProps, isPressed} = usePress({
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={emptyArray}
            content={description}
        >
            <div
                {...mergeProps(pressProps, hoverProps)}
                ref={localRef}
                aria-label={description}
                // Disable the ability to focus this icon button! The icon buttons in the
                // selection toolbar are only mouse accessible. They are not keyboard
                // accessible. By being focusable then the button steals focus when you click
                // on it, so instead make the button not focusable. This also makes it so the
                // button is not reachable in tab order.
                tabIndex={undefined}
                className={sprinkles({
                    paddingY: "1",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                })}
            >
                <Box
                    // We implement dividers in this funky way so that as the mouse scrubs left and
                    // right over our toolbar the tooltips immediately disappear/reappear because
                    // there is no gap in between the hovered elements.
                    paddingRight={dividerRight ? "1" : "0.5"}
                    borderRight={dividerRight ? "grey-5" : undefined}
                    paddingLeft={dividerLeft ? "1" : undefined}
                >
                    <Box
                        padding="1"
                        borderRadius="1"
                        color={isPressed || isActive ? "grey-100" : "grey-70"}
                        backgroundColor={
                            isPressedAndActive
                                ? "grey-20"
                                : isPressed || isActive
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
                                : undefined
                        }
                    >
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing["4"],
                            }}
                        >
                            {children}
                        </IconContext.Provider>
                    </Box>
                </Box>
            </div>
        </Tooltip>
    );
}
