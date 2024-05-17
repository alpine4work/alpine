import {useCallback, useMemo, useRef} from "react";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {ChannelViewNameEditor} from "~/client/forum/internal/channel_view_name_editor.js";
import {postViewMaxWidth} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

export function ChannelDesktopCreator({
    withMobileLayout,
    channelId,
    shouldInitiallyFocusChannelName,
    createChannel,
}: {
    withMobileLayout: boolean;
    channelId: ChannelId;
    shouldInitiallyFocusChannelName: boolean;
    createChannel: (name: string) => Promise<void>;
}) {
    const currentTime = useCurrentTimeRoundedToHour();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const navigationBarRef = useRef<NavigationBarRef>(null);

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
        ref: navigationBarRef,
        withMobileLayout,
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
        desktopTitleMaxWidth: postViewMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        // We want to render the "more" actions button but the user shouldn't be able
        // to use any actions until the channel has been created.
        menuActions: [
            [
                {
                    label: "Copy link",
                    isDisabled: true,
                    onPress: () => {},
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
            withMobileLayout={withMobileLayout}
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
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
