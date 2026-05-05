import {ComponentType} from "react";
import {Composition as ActualComposition} from "remotion";
import {ShareSwitchDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/001_share_switch_demo_composition.js";
import {shareSwitchDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/001_share_switch_demo_shared.js";
import {ImageGalleryDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_composition.js";
import {
    imageGalleryDemoDurationInFrames,
    imageGalleryDemoRecordingHeight,
    imageGalleryDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_shared.js";
import {TaskProgressWheelDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/003_task_progress_wheel_demo_composition.js";
import {
    taskProgressWheelDemoDurationInFrames,
    taskProgressWheelDemoRecordingHeight,
    taskProgressWheelDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/003_task_progress_wheel_demo_shared.js";
import {ReplyToChatMessageRangeDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/004_reply_to_chat_message_range_demo_composition.js";
import {
    replyToChatMessageRangeDemoDurationInFrames,
    replyToChatMessageRangeDemoRecordingHeight,
    replyToChatMessageRangeDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/004_reply_to_chat_message_range_demo_shared.js";
import {ExportTableToMarkdownDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/005_export_table_to_markdown_demo_composition.js";
import {
    exportTableToMarkdownDemoDurationInFrames,
    exportTableToMarkdownDemoRecordingHeight,
    exportTableToMarkdownDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/005_export_table_to_markdown_demo_shared.js";
import {ChannelAndChatRoomFilePreviewDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/006_channel_and_chat_room_file_preview_demo_composition.js";
import {
    channelAndChatRoomFilePreviewDemoDurationInFrames,
    channelAndChatRoomFilePreviewDemoRecordingHeight,
    channelAndChatRoomFilePreviewDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/006_channel_and_chat_room_file_preview_demo_shared.js";
import {PostReactionsDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/007_post_reactions_demo_composition.js";
import {
    postReactionsDemoDurationInFrames,
    postReactionsDemoRecordingHeight,
    postReactionsDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/007_post_reactions_demo_shared.js";
import {DocumentAgentCollaborationDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/008_document_agent_collaboration_demo_composition.js";
import {
    documentAgentCollaborationDemoDurationInFrames,
    documentAgentCollaborationDemoRecordingHeight,
    documentAgentCollaborationDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/008_document_agent_collaboration_demo_shared.js";
import {TaskTemplatesDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/009_task_templates_demo_composition.js";
import {
    taskTemplatesDemoDurationInFrames,
    taskTemplatesDemoRecordingHeight,
    taskTemplatesDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/009_task_templates_demo_shared.js";
import {PasteBulletListIntoTasksDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/010_paste_bullet_list_into_tasks_demo_composition.js";
import {
    pasteBulletListIntoTasksDemoDurationInFrames,
    pasteBulletListIntoTasksDemoRecordingHeight,
    pasteBulletListIntoTasksDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/010_paste_bullet_list_into_tasks_demo_shared.js";
import {SearchProjectPreviewDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/011_search_project_preview_demo_composition.js";
import {searchProjectPreviewDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/011_search_project_preview_demo_shared.js";
import {ChatMessageParagraphReactionsDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/012_chat_message_paragraph_reactions_demo_composition.js";
import {chatMessageParagraphReactionsDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/012_chat_message_paragraph_reactions_demo_shared.js";
import {InboxTriageDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/013_inbox_triage_demo_composition.js";
import {inboxTriageDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/013_inbox_triage_demo_shared.js";
import {FeedPostWithCollectionPreviewDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/014_feed_post_with_collection_preview_demo_composition.js";
import {feedPostWithCollectionPreviewDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/014_feed_post_with_collection_preview_demo_shared.js";
import {SummarizeViewedPostDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/015_summarize_viewed_post_demo_composition.js";
import {
    summarizeViewedPostDemoDurationInFrames,
    summarizeViewedPostDemoRecordingHeight,
    summarizeViewedPostDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/015_summarize_viewed_post_demo_shared.js";
import {MyTasksOverviewDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/016_my_tasks_overview_demo_composition.js";
import {myTasksOverviewDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/016_my_tasks_overview_demo_shared.js";
import {ActiveTasksInSuggestedDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/017_active_tasks_in_suggested_demo_composition.js";
import {activeTasksInSuggestedDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/017_active_tasks_in_suggested_demo_shared.js";
import {DragToSetTaskDueDateDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/018_drag_to_set_task_due_date_demo_composition.js";
import {dragToSetTaskDueDateDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/018_drag_to_set_task_due_date_demo_shared.js";
import {DocumentMentionInChatDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/019_document_mention_in_chat_demo_composition.js";
import {
    documentMentionInChatDemoDurationInFrames,
    documentMentionInChatDemoRecordingHeight,
    documentMentionInChatDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/019_document_mention_in_chat_demo_shared.js";
import {computeScalableDemoCompositionMargin} from "~/admin/marketing/2026_04_scalable_demos/helpers/compute_scalable_demo_composition_margin.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ScalableDemosRemotionRoot() {
    return (
        <>
            <Composition
                id="001-share-switch-demo"
                component={ShareSwitchDemoComposition}
                recordingWidth={scalableDemoNarrowViewportWidth}
                durationInFrames={shareSwitchDemoDurationInFrames}
            />
            <Composition
                id="002-image-gallery-demo"
                component={ImageGalleryDemoComposition}
                recordingWidth={imageGalleryDemoRecordingWidth}
                recordingHeight={imageGalleryDemoRecordingHeight}
                durationInFrames={imageGalleryDemoDurationInFrames}
            />
            <Composition
                id="003-task-progress-wheel-demo"
                component={TaskProgressWheelDemoComposition}
                recordingWidth={taskProgressWheelDemoRecordingWidth}
                recordingHeight={taskProgressWheelDemoRecordingHeight}
                durationInFrames={taskProgressWheelDemoDurationInFrames}
            />
            <Composition
                id="004-reply-to-chat-message-range-demo"
                component={ReplyToChatMessageRangeDemoComposition}
                recordingWidth={replyToChatMessageRangeDemoRecordingWidth}
                recordingHeight={replyToChatMessageRangeDemoRecordingHeight}
                durationInFrames={replyToChatMessageRangeDemoDurationInFrames}
            />
            <Composition
                id="005-export-table-to-markdown-demo"
                component={ExportTableToMarkdownDemoComposition}
                recordingWidth={exportTableToMarkdownDemoRecordingWidth}
                recordingHeight={exportTableToMarkdownDemoRecordingHeight}
                durationInFrames={exportTableToMarkdownDemoDurationInFrames}
            />
            <Composition
                id="006-channel-and-chat-room-file-preview-demo"
                component={ChannelAndChatRoomFilePreviewDemoComposition}
                recordingWidth={channelAndChatRoomFilePreviewDemoRecordingWidth}
                recordingHeight={channelAndChatRoomFilePreviewDemoRecordingHeight}
                durationInFrames={channelAndChatRoomFilePreviewDemoDurationInFrames}
            />
            <Composition
                id="007-post-reactions-demo"
                component={PostReactionsDemoComposition}
                recordingWidth={postReactionsDemoRecordingWidth}
                recordingHeight={postReactionsDemoRecordingHeight}
                durationInFrames={postReactionsDemoDurationInFrames}
            />
            <Composition
                id="008-document-agent-collaboration-demo"
                component={DocumentAgentCollaborationDemoComposition}
                recordingWidth={documentAgentCollaborationDemoRecordingWidth}
                recordingHeight={documentAgentCollaborationDemoRecordingHeight}
                durationInFrames={documentAgentCollaborationDemoDurationInFrames}
            />
            <Composition
                id="009-task-templates-demo"
                component={TaskTemplatesDemoComposition}
                recordingWidth={taskTemplatesDemoRecordingWidth}
                recordingHeight={taskTemplatesDemoRecordingHeight}
                durationInFrames={taskTemplatesDemoDurationInFrames}
            />
            <Composition
                id="010-paste-bullet-list-into-tasks-demo"
                component={PasteBulletListIntoTasksDemoComposition}
                recordingWidth={pasteBulletListIntoTasksDemoRecordingWidth}
                recordingHeight={pasteBulletListIntoTasksDemoRecordingHeight}
                durationInFrames={pasteBulletListIntoTasksDemoDurationInFrames}
            />
            <Composition
                id="011-search-project-preview-demo"
                component={SearchProjectPreviewDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={searchProjectPreviewDemoDurationInFrames}
            />
            <Composition
                id="012-chat-message-paragraph-reactions-demo"
                component={ChatMessageParagraphReactionsDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={chatMessageParagraphReactionsDemoDurationInFrames}
            />
            <Composition
                id="013-inbox-triage-demo"
                component={InboxTriageDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={inboxTriageDemoDurationInFrames}
            />
            <Composition
                id="014-feed-post-with-collection-preview-demo"
                component={FeedPostWithCollectionPreviewDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={feedPostWithCollectionPreviewDemoDurationInFrames}
            />
            <Composition
                id="015-summarize-viewed-post-demo"
                component={SummarizeViewedPostDemoComposition}
                recordingWidth={summarizeViewedPostDemoRecordingWidth}
                recordingHeight={summarizeViewedPostDemoRecordingHeight}
                durationInFrames={summarizeViewedPostDemoDurationInFrames}
            />
            <Composition
                id="016-my-tasks-overview-demo"
                component={MyTasksOverviewDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={myTasksOverviewDemoDurationInFrames}
            />
            <Composition
                id="017-active-tasks-in-suggested-demo"
                component={ActiveTasksInSuggestedDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={activeTasksInSuggestedDemoDurationInFrames}
            />
            <Composition
                id="018-drag-to-set-task-due-date-demo"
                component={DragToSetTaskDueDateDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={dragToSetTaskDueDateDemoDurationInFrames}
            />
            <Composition
                id="019-document-mention-in-chat-demo"
                component={DocumentMentionInChatDemoComposition}
                recordingWidth={documentMentionInChatDemoRecordingWidth}
                recordingHeight={documentMentionInChatDemoRecordingHeight}
                durationInFrames={documentMentionInChatDemoDurationInFrames}
            />
        </>
    );
}

function Composition({
    id,
    component,
    recordingWidth,
    recordingHeight = Math.round(recordingWidth / goldenRatio),
    durationInFrames,
}: {
    id: string;
    component: ComponentType<{}>;
    recordingWidth: number;
    recordingHeight?: number;
    durationInFrames: number;
}) {
    const w = recordingWidth;
    const h = recordingHeight;
    const m = computeScalableDemoCompositionMargin(w, h);

    return (
        <ActualComposition
            id={id}
            component={component}
            fps={scalableDemoFps}
            durationInFrames={durationInFrames}
            width={Math.round((w + m * 2) * 2)}
            height={Math.round((h + m * 2) * 2)}
        />
    );
}
