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
import {CursorMentionInTaskDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/020_cursor_mention_in_task_demo_composition.js";
import {cursorMentionInTaskDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/020_cursor_mention_in_task_demo_shared.js";
import {DocumentCommentHighlightsDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/021_document_comment_highlights_demo_composition.js";
import {documentCommentHighlightsDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/021_document_comment_highlights_demo_shared.js";
import {DocumentFileFloatDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/022_document_file_float_demo_composition.js";
import {documentFileFloatDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/022_document_file_float_demo_shared.js";
import {HomeFeedCreatedAndSharedDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/023_home_feed_created_and_shared_demo_composition.js";
import {homeFeedCreatedAndSharedDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/023_home_feed_created_and_shared_demo_shared.js";
import {ChatgptCursorBugFixDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/024_chatgpt_cursor_bug_fix_demo_composition.js";
import {chatgptCursorBugFixDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/024_chatgpt_cursor_bug_fix_demo_shared.js";
import {InboxActionPersistenceDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/025_inbox_action_persistence_demo_composition.js";
import {
    inboxActionPersistenceDemoDurationInFrames,
    inboxActionPersistenceDemoRecordingHeight,
    inboxActionPersistenceDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/025_inbox_action_persistence_demo_shared.js";
import {CodeBlockEditorKeyboardShortcutsDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/026_code_block_editor_keyboard_shortcuts_demo_composition.js";
import {codeBlockEditorKeyboardShortcutsDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/026_code_block_editor_keyboard_shortcuts_demo_shared.js";
import {SearchTasksClosedByMasonLastWeekDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/027_search_tasks_closed_by_mason_last_week_demo_composition.js";
import {searchTasksClosedByMasonLastWeekDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/027_search_tasks_closed_by_mason_last_week_demo_shared.js";
import {ProjectsCompletionStateDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/028_projects_completion_state_demo_composition.js";
import {
    projectsCompletionStateDemoDurationInFrames,
    projectsCompletionStateDemoHeight,
    projectsCompletionStateDemoWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/028_projects_completion_state_demo_shared.js";
import {ShareTaskCollectionToChatDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/029_share_task_collection_to_chat_demo_composition.js";
import {
    shareTaskCollectionToChatDemoDurationInFrames,
    shareTaskCollectionToChatDemoHeight,
    shareTaskCollectionToChatDemoWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/029_share_task_collection_to_chat_demo_shared.js";
import {VideoGalleriesSideBySideDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/030_video_galleries_side_by_side_demo_composition.js";
import {
    videoGalleriesSideBySideDemoDurationInFrames,
    videoGalleriesSideBySideDemoHeight,
    videoGalleriesSideBySideDemoWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/030_video_galleries_side_by_side_demo_shared.js";
import {computeScalableDemoCompositionDeprecatedMargin} from "~/admin/marketing/2026_04_scalable_demos/helpers/compute_scalable_demo_composition_deprecated_margin.js";
import {
    scalableDemoDefaultViewport,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoWideViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ScalableDemosRemotionRoot() {
    return (
        <>
            <CompositionWithDeprecatedMargin
                id="001-share-switch-demo"
                component={ShareSwitchDemoComposition}
                recordingWidth={scalableDemoDefaultViewportWidth}
                durationInFrames={shareSwitchDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="002-image-gallery-demo"
                component={ImageGalleryDemoComposition}
                recordingWidth={imageGalleryDemoRecordingWidth}
                recordingHeight={imageGalleryDemoRecordingHeight}
                durationInFrames={imageGalleryDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="003-task-progress-wheel-demo"
                component={TaskProgressWheelDemoComposition}
                recordingWidth={taskProgressWheelDemoRecordingWidth}
                recordingHeight={taskProgressWheelDemoRecordingHeight}
                durationInFrames={taskProgressWheelDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="004-reply-to-chat-message-range-demo"
                component={ReplyToChatMessageRangeDemoComposition}
                recordingWidth={replyToChatMessageRangeDemoRecordingWidth}
                recordingHeight={replyToChatMessageRangeDemoRecordingHeight}
                durationInFrames={replyToChatMessageRangeDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="005-export-table-to-markdown-demo"
                component={ExportTableToMarkdownDemoComposition}
                recordingWidth={exportTableToMarkdownDemoRecordingWidth}
                recordingHeight={exportTableToMarkdownDemoRecordingHeight}
                durationInFrames={exportTableToMarkdownDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="006-channel-and-chat-room-file-preview-demo"
                component={ChannelAndChatRoomFilePreviewDemoComposition}
                recordingWidth={channelAndChatRoomFilePreviewDemoRecordingWidth}
                recordingHeight={channelAndChatRoomFilePreviewDemoRecordingHeight}
                durationInFrames={channelAndChatRoomFilePreviewDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="007-post-reactions-demo"
                component={PostReactionsDemoComposition}
                recordingWidth={postReactionsDemoRecordingWidth}
                recordingHeight={postReactionsDemoRecordingHeight}
                durationInFrames={postReactionsDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="008-document-agent-collaboration-demo"
                component={DocumentAgentCollaborationDemoComposition}
                recordingWidth={documentAgentCollaborationDemoRecordingWidth}
                recordingHeight={documentAgentCollaborationDemoRecordingHeight}
                durationInFrames={documentAgentCollaborationDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="009-task-templates-demo"
                component={TaskTemplatesDemoComposition}
                recordingWidth={taskTemplatesDemoRecordingWidth}
                recordingHeight={taskTemplatesDemoRecordingHeight}
                durationInFrames={taskTemplatesDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="010-paste-bullet-list-into-tasks-demo"
                component={PasteBulletListIntoTasksDemoComposition}
                recordingWidth={pasteBulletListIntoTasksDemoRecordingWidth}
                recordingHeight={pasteBulletListIntoTasksDemoRecordingHeight}
                durationInFrames={pasteBulletListIntoTasksDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="011-search-project-preview-demo"
                component={SearchProjectPreviewDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={searchProjectPreviewDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="012-chat-message-paragraph-reactions-demo"
                component={ChatMessageParagraphReactionsDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={chatMessageParagraphReactionsDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="013-inbox-triage-demo"
                component={InboxTriageDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={inboxTriageDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="014-feed-post-with-collection-preview-demo"
                component={FeedPostWithCollectionPreviewDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={feedPostWithCollectionPreviewDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="015-summarize-viewed-post-demo"
                component={SummarizeViewedPostDemoComposition}
                recordingWidth={summarizeViewedPostDemoRecordingWidth}
                recordingHeight={summarizeViewedPostDemoRecordingHeight}
                durationInFrames={summarizeViewedPostDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="016-my-tasks-overview-demo"
                component={MyTasksOverviewDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={myTasksOverviewDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="017-active-tasks-in-suggested-demo"
                component={ActiveTasksInSuggestedDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={activeTasksInSuggestedDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="018-drag-to-set-task-due-date-demo"
                component={DragToSetTaskDueDateDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={dragToSetTaskDueDateDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="019-document-mention-in-chat-demo"
                component={DocumentMentionInChatDemoComposition}
                recordingWidth={documentMentionInChatDemoRecordingWidth}
                recordingHeight={documentMentionInChatDemoRecordingHeight}
                durationInFrames={documentMentionInChatDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="020-cursor-mention-in-task-demo"
                component={CursorMentionInTaskDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={cursorMentionInTaskDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="021-document-comment-highlights-demo"
                component={DocumentCommentHighlightsDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={documentCommentHighlightsDemoDurationInFrames}
            />
            <CompositionWithDeprecatedMargin
                id="022-document-file-float-demo"
                component={DocumentFileFloatDemoComposition}
                recordingWidth={scalableDemoWideViewportWidth}
                durationInFrames={documentFileFloatDemoDurationInFrames}
            />
            <Composition
                id="023-home-feed-created-and-shared-demo"
                component={HomeFeedCreatedAndSharedDemoComposition}
                durationInFrames={homeFeedCreatedAndSharedDemoDurationInFrames}
            />
            <Composition
                id="024-chatgpt-cursor-bug-fix-demo"
                component={ChatgptCursorBugFixDemoComposition}
                width={scalableDemoDefaultViewport.width}
                height={scalableDemoDefaultViewport.width}
                durationInFrames={chatgptCursorBugFixDemoDurationInFrames}
            />
            <Composition
                id="025-inbox-action-persistence-demo"
                component={InboxActionPersistenceDemoComposition}
                width={inboxActionPersistenceDemoRecordingWidth}
                height={inboxActionPersistenceDemoRecordingHeight}
                durationInFrames={inboxActionPersistenceDemoDurationInFrames}
            />
            <Composition
                id="026-code-block-editor-keyboard-shortcuts-demo"
                component={CodeBlockEditorKeyboardShortcutsDemoComposition}
                durationInFrames={codeBlockEditorKeyboardShortcutsDemoDurationInFrames}
            />
            <Composition
                id="027-search-tasks-closed-by-mason-last-week-demo"
                component={SearchTasksClosedByMasonLastWeekDemoComposition}
                width={scalableDemoWideViewportWidth}
                durationInFrames={searchTasksClosedByMasonLastWeekDemoDurationInFrames}
            />
            <Composition
                id="028-projects-completion-state-demo"
                component={ProjectsCompletionStateDemoComposition}
                width={projectsCompletionStateDemoWidth}
                height={projectsCompletionStateDemoHeight}
                durationInFrames={projectsCompletionStateDemoDurationInFrames}
            />
            <Composition
                id="029-share-task-collection-to-chat-demo"
                component={ShareTaskCollectionToChatDemoComposition}
                width={shareTaskCollectionToChatDemoWidth}
                height={shareTaskCollectionToChatDemoHeight}
                durationInFrames={shareTaskCollectionToChatDemoDurationInFrames}
            />
            <Composition
                id="030-video-galleries-side-by-side-demo"
                component={VideoGalleriesSideBySideDemoComposition}
                width={videoGalleriesSideBySideDemoWidth}
                height={videoGalleriesSideBySideDemoHeight}
                durationInFrames={videoGalleriesSideBySideDemoDurationInFrames}
            />
        </>
    );
}

function Composition({
    id,
    component,
    width = scalableDemoDefaultViewportWidth,
    height = Math.round(width / goldenRatio),
    durationInFrames,
}: {
    id: string;
    component: ComponentType<{}>;
    width?: number;
    height?: number;
    durationInFrames: number;
}) {
    return (
        <ActualComposition
            id={id}
            component={component}
            fps={scalableDemoFps}
            durationInFrames={durationInFrames}
            width={width * 2}
            height={height * 2}
        />
    );
}

/** @deprecated */
function CompositionWithDeprecatedMargin({
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
    const m = computeScalableDemoCompositionDeprecatedMargin(w, h);

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
