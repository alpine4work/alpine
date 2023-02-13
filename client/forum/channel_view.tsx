import {CaretDown} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {MenuButton} from "~/client/design/menu_button";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/design/modal_with_buttons";
import {TextInput} from "~/client/design/text_input";
import {PostList} from "~/client/forum/post_list";
import {PostListView, postListViewMargin, postMaxWidth} from "~/client/forum/post_list_view";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ChannelModel} from "~/shared/models/channel_model";
import {PostModel} from "~/shared/models/post_model";
import {getChannelPosts, updateChannelName} from "~/shared/rpc/forum_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function ChannelView({
    channel: initialChannel,
    initialChannelPostsResult,
}: {
    channel: ChannelModel;
    initialChannelPostsResult: {posts: ReadonlyArray<PostModel>; hasMorePosts: boolean};
}) {
    const context = useAppContext();

    const [channel, setChannel] = useState(initialChannel);
    const [shouldShowEditNameModal, setShouldShowEditNameModal] = useState(false);
    const [shouldShowEditDescriptionModal, setShouldShowEditDescriptionModal] = useState(false);

    return (
        <Box
            display="flex"
            flexDirection="column"
            height="full"
            overflow="hidden"
            position="relative"
            zIndex="0"
        >
            <Box
                flexShrink="0"
                backgroundColor="grey-0"
                borderBottom="grey-10"
                position="relative"
                zIndex="10"
                paddingX={postListViewMargin}
            >
                <Box
                    width="full"
                    maxWidth={postMaxWidth}
                    height="10"
                    marginX="auto"
                    display="flex"
                    alignItems="center"
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
                                    await navigator.clipboard.writeText(url.toString());
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
            <Box flexGrow="1" overflow="hidden" position="relative" zIndex="0">
                <PostListView
                    initialPosts={() =>
                        PostList.empty
                            .setChannelHeader({channel})
                            .insertManyPostsAtStart(initialChannelPostsResult.posts)
                            .setHasMorePosts(initialChannelPostsResult.hasMorePosts)
                    }
                    onLoadMorePosts={({limit, afterCursor}) =>
                        getChannelPosts(context, {channelId: channel.id, limit, afterCursor})
                    }
                />
            </Box>
            {shouldShowEditNameModal && (
                <ChannelEditNameModal
                    channel={channel}
                    onUpdateChannel={setChannel}
                    onClose={() => setShouldShowEditNameModal(false)}
                />
            )}
        </Box>
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
            primaryButtonPressErrorTitle="Couldn’t save channel name"
            onPrimaryButtonPress={async () => {
                await updateChannelName(context, {
                    channelId: channel.id,
                    name,
                });

                onUpdateChannel(channel => channel.clone({name}));
            }}
        >
            {({isPending, pressPrimaryButton}) => (
                <Box paddingTop="5" paddingX="5" paddingBottom="7">
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
