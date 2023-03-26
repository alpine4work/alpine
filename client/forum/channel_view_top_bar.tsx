import {CaretDown} from "@phosphor-icons/react";
import {useEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuButton} from "~/client/design/menu_button";
import {defaultModalMaxWidth} from "~/client/design/modal";
import {ModalDialog} from "~/client/design/modal_dialog";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons";
import {TextInput, textInputClassName} from "~/client/design/text_input";
import {
    postListViewAsideMaxWidth,
    postListViewMarginX,
    postViewMaxWidth,
} from "~/client/forum/post_list_view";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {MessageContent} from "~/shared/content/message_content_schema";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ChannelModel} from "~/shared/models/channel_model";
import {updateChannelDescription, updateChannelName} from "~/shared/rpc/forum_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function ChannelViewTopBar({
    channel,
    onUpdateChannel,
}: {
    channel: ChannelModel;
    onUpdateChannel: (update: (channel: ChannelModel) => ChannelModel) => void;
}) {
    const isMobile = useIsMobile();
    const [shouldShowEditNameModal, setShouldShowEditNameModal] = useState(false);
    const [shouldShowEditDescriptionModal, setShouldShowEditDescriptionModal] = useState(false);

    return (
        <>
            <Box
                flexShrink="0"
                height="10"
                backgroundColor="grey-0"
                borderBottom="grey-10"
                position="relative"
                zIndex="10"
            >
                <Box
                    width="full"
                    height="full"
                    paddingX={isMobile ? "1" : postListViewMarginX}
                    marginX="auto"
                    display="flex"
                    alignItems="center"
                    style={{
                        maxWidth: !isContentEmpty(channel.description.doc)
                            ? addRemLengths(
                                  spacing[postListViewMarginX],
                                  spacing[postViewMaxWidth],
                                  spacing[postListViewMarginX],
                                  spacing[postListViewAsideMaxWidth],
                                  spacing[postListViewMarginX],
                              )
                            : addRemLengths(
                                  spacing[postListViewMarginX],
                                  spacing[postViewMaxWidth],
                                  spacing[postListViewMarginX],
                              ),
                    }}
                >
                    <MenuButton
                        offset="3"
                        offsetAlong="-1"
                        actions={[
                            {
                                label: "Copy link",
                                pressErrorTitle: "Couldn’t copy post link",
                                onPress: async () => {
                                    const url = new URL(
                                        `/s/${channel.spaceId}/channels/${channel.id}`,
                                        window.location.href,
                                    );
                                    await writeTextToClipboard(url.toString());
                                },
                            },
                            {
                                label: "Edit name",
                                onPress: () => setShouldShowEditNameModal(true),
                            },
                            {
                                label: "Edit description",
                                onPress: () => setShouldShowEditDescriptionModal(true),
                            },
                        ]}
                    >
                        <Button
                            icon={<CaretDown size={spacing["3"]} />}
                            iconPlacement="end"
                            paddingX="2"
                        >
                            <h1
                                className={sprinkles({
                                    fontStyle: "truncate-semi-bold",
                                    fontSize: "200",
                                })}
                            >
                                {channel.name}
                            </h1>
                        </Button>
                    </MenuButton>
                </Box>
            </Box>
            {shouldShowEditNameModal && (
                <ChannelEditNameModal
                    channel={channel}
                    onUpdateChannel={onUpdateChannel}
                    onClose={() => setShouldShowEditNameModal(false)}
                />
            )}
            {shouldShowEditDescriptionModal && (
                <ChannelEditDescriptionModal
                    channel={channel}
                    onUpdateChannel={onUpdateChannel}
                    onClose={() => setShouldShowEditDescriptionModal(false)}
                />
            )}
        </>
    );
}

function ChannelEditNameModal({
    channel,
    onUpdateChannel,
    onClose,
}: {
    channel: ChannelModel;
    onUpdateChannel: (update: (channel: ChannelModel) => ChannelModel) => void;
    onClose: () => void;
}) {
    const context = useAppContext();
    const modalRef = useRef<ModalWithButtonsRef>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [name, setName] = useState(channel.name);

    useEffect(() => {
        const inputElement = assertExists(inputRef.current);
        inputElement.focus();
        inputElement.select();
    }, []);

    return (
        <ModalWithButtons
            ref={modalRef}
            title="Edit channel name"
            onClose={onClose}
            primaryButtonLabel="Save"
            isPrimaryButtonDisabled={name.length === 0}
            primaryButtonPressErrorTitle="Couldn’t save channel name"
            onPrimaryButtonPress={async () => {
                const trimmedName = name.trim();

                await updateChannelName(context, {
                    channelId: channel.id,
                    name: trimmedName,
                });

                onUpdateChannel(channel => channel.clone({name: trimmedName}));
            }}
        >
            {({isPending, pressPrimaryButton}) => (
                <Box paddingTop="5" paddingX="5" paddingBottom="5">
                    <TextInput
                        ref={inputRef}
                        label="Channel name"
                        hideLabel={true}
                        fontSize="200"
                        placeholder="e.g. Marketing"
                        value={name}
                        onChange={name => {
                            // Block updates while pending...
                            if (isPending) return;
                            setName(name);
                        }}
                        onEnter={pressPrimaryButton}
                    />
                </Box>
            )}
        </ModalWithButtons>
    );
}

function ChannelEditDescriptionModal({
    channel,
    onUpdateChannel,
    onClose,
}: {
    channel: ChannelModel;
    onUpdateChannel: (update: (channel: ChannelModel) => ChannelModel) => void;
    onClose: () => void;
}) {
    const context = useAppContext();
    const modalRef = useRef<ModalWithButtonsRef>(null);
    const editorRef = useRef<ContentEditorRef>(null);

    const [{state, hasContentChanged}, setState] = useState<{
        state: ContentEditorState<MessageContent>;
        hasContentChanged: boolean;
    }>(() => ({
        state: ContentEditorState.create(channel.description, {selectionAt: "end"}),
        hasContentChanged: false,
    }));
    const [shouldConfirmClose, setShouldConfirmClose] = useState(false);

    useEffect(() => {
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, []);

    return (
        <>
            <ModalWithButtons
                ref={modalRef}
                title="Edit channel description"
                disableCloseAnimation={hasContentChanged}
                onClose={() => {
                    if (hasContentChanged) {
                        setShouldConfirmClose(true);
                    } else {
                        onClose();
                    }
                }}
                primaryButtonLabel="Save"
                primaryButtonPressErrorTitle="Couldn’t save channel description"
                onPrimaryButtonPress={async () => {
                    const description = state.getContent();

                    await updateChannelDescription(context, {
                        channelId: channel.id,
                        description: description.doc,
                    });

                    onUpdateChannel(channel => channel.clone({description}));
                    onClose();
                }}
                // A little wider than the default modal width so the confirmation modal
                // doesn't line up precisely.
                maxWidth={addRemLengths(spacing[defaultModalMaxWidth], spacing["4"])}
            >
                {({isPending, pressPrimaryButton}) => (
                    <Box paddingTop="5" paddingX="5" paddingBottom="5">
                        <FocusRing isVisibleWhenFocusWithin={true} offset="border">
                            <Box className={textInputClassName}>
                                <ContentEditor
                                    ref={editorRef}
                                    aria-label="Channel description"
                                    placeholder="What’s the purpose of this channel?"
                                    state={state}
                                    onChange={(state, transaction) => {
                                        // Don't change content while we are pending...
                                        if (transaction.docChanged && isPending) return;

                                        setState(({state: oldState, hasContentChanged}) => ({
                                            state,
                                            hasContentChanged:
                                                hasContentChanged || transaction.docChanged,
                                        }));
                                    }}
                                    onModEnter={event => {
                                        event.preventDefault();
                                        pressPrimaryButton();
                                    }}
                                    className={sprinkles({
                                        paddingX: "0.5",
                                        paddingY: "2",
                                        height: "64",
                                        overflowY: "scroll",
                                    })}
                                />
                            </Box>
                        </FocusRing>
                    </Box>
                )}
            </ModalWithButtons>
            {shouldConfirmClose && (
                <ModalDialog
                    title="Discard changes?"
                    description="Changes you made to the post will not be saved."
                    onClose={() => setShouldConfirmClose(false)}
                    primaryButtonLabel="Discard"
                    onPrimaryButtonPress={onClose}
                    cancelButtonLabel="Keep editing"
                />
            )}
        </>
    );
}
