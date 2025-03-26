import {Link as LinkIcon, Star} from "phosphor-react";
import {useCallback, useMemo} from "react";
import {ChannelViewNameEditor} from "~/client/forum/internal/channel_view_name_editor.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

export function ChannelDesktopCreator({
    channelId,
    shouldInitiallyFocusChannelName,
    createChannel,
}: {
    channelId: ChannelId;
    shouldInitiallyFocusChannelName: boolean;
    createChannel: (name: string) => Promise<void>;
}) {
    const currentTime = useCurrentTimeRoundedToHour();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const channel = useMemo(
        () =>
            new ChannelModel({
                id: channelId,
                spaceId: space.id,
                createdTime: currentTime,
                name: "",
                description: emptyMessageContentWithReferences,
            }),
        [channelId, currentTime, space.id],
    );

    const navigationBar = useNavigationBar({
        withoutDisappearingTitle: true,
        title: (
            <ChannelViewNameEditor
                isCreatingChannel={true}
                shouldInitiallyFocusChannelName={shouldInitiallyFocusChannelName}
                initialName=""
                onCancel={() => navigate(-1)}
                onSave={createChannel}
            />
        ),
        // Create a bit of space to the left so we don't cut off the channel name
        // editor border.
        desktopTitleLeftSlop: "1",
        desktopTitleMaxWidth: contentStyles.contentMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        // We want to render the "more" actions button but the user shouldn't be able
        // to use any actions until the channel has been created.
        menuActions: [
            [
                {
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    isDisabled: true,
                    onPress: () => {},
                },
                {
                    label: "Favorite",
                    icon: <Star />,
                    iconPlacement: "end",
                    isDisabled: true,
                    onPress: () => {
                        // NOCOMMIT: Implement!
                    },
                },
            ],
            [
                {
                    label: "Edit name",
                    isDisabled: true,
                    onPress: () => {},
                },
                {
                    label: "Edit description",
                    isDisabled: true,
                    onPress: () => {},
                },
            ],
        ],
    });

    return (
        <PostListView
            channelHeader={useMemo(
                () => ({
                    isOnlyNavigationBar: false,
                    channel,
                    isCreatingChannel: true,
                    isEditingDescription: false,
                    onCancelDescriptionEditing: noop,
                    onSaveDescription: asyncNoop,
                }),
                [channel],
            )}
            posts={useMemo(
                () => PostBasicList.new({type: "Many", hasMorePosts: false, posts: []}),
                [],
            )}
            onTogglePostComments={useCallback(() => {}, [])}
            onUpdatePostComments={useCallback(() => {}, [])}
            onLoadMorePosts={asyncNoop}
            shouldBeConnectedToChannelRealtime={false}
            onPostRealtimeEventTransaction={useCallback(() => {}, [])}
            navigationBar={navigationBar}
        />
    );
}
