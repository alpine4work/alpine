import {Memo} from "react";
import {
    PostListLoadedPostCommentItem,
    PostListOptimisticPostCommentItem,
} from "~/client/web/forum/post_list.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {MessageView} from "~/client/web/messaging/message_view.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {
    JumpToMessageRangeOptions,
    JumpToMessageRangeState,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {JumpToPostRangeOptions} from "~/client/web/messaging/use_jump_to_post_range.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * This is essentially just a wrapper around the `MessageView` component. It's main
 * purpose is to unwrap the `hasCommentAccessLevel` store into a boolean and pass
 * it to the `MessageView` component. See more about this decision [1].
 *
 * [1]:
 *     https://app.graphite.com/github/pr/cyberworlds/cyberworlds/1317/site-access-policies#comment-PRRC_kwDOH2ktg86xXkD7
 */
export function PostCommentView({
    item,
    fileAttachmentTarget,
    isLastComment,
    previousComment,
    nextComment,
    messageEditing,
    jumpToMessageRangeState,
    onJumpToMessageRange: jumpToMessageRange,
    onJumpToPostRange: jumpToPostRange,
    onDeleteMessage,
    onReplyToMessage,
    onDeleteMessageReaction: handleDeleteMessageReaction,
    onSetMessageReaction: handleSetMessageReaction,
    onUpdatePostCommentsOptimistically,
    disableExpensiveFeaturesDuringScroll,
    hasCommentAccessLevel,
}: {
    item: PostListLoadedPostCommentItem | PostListOptimisticPostCommentItem;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    isLastComment: boolean;
    previousComment: PostCommentModel | OptimisticMessageModel | null;
    nextComment: PostCommentModel | OptimisticMessageModel | null;
    messageEditing: MessageEditing<PostId>;
    jumpToMessageRangeState: JumpToMessageRangeState<PostId> | null;
    onJumpToMessageRange: Memo<(options: JumpToMessageRangeOptions<PostId>) => void>;
    onJumpToPostRange: Memo<(options: JumpToPostRangeOptions) => void>;
    hasCommentAccessLevel: Store<boolean>;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<PostId>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<PostId>>;
    disableExpensiveFeaturesDuringScroll: boolean;

    /**
     * Arbitrarily update the comments for a post optimistically. If the promise
     * rejects then we undo the optimistic update.
     */
    onUpdatePostCommentsOptimistically: Memo<
        <PromiseValue>(
            postId: PostId,
            promise: Promise<PromiseValue>,
            update: (
                postComments: MessageList<PostCommentModel>,
                promiseValue: PromiseValue | undefined,
            ) => MessageList<PostCommentModel>,
        ) => void
    >;
}) {
    const isReadOnly = !useStore(hasCommentAccessLevel);
    return (
        <MessageView
            messageNoun="comment"
            message={item.postComment}
            fileAttachmentTarget={fileAttachmentTarget}
            isFirstMessage={item.postCommentIndex === 0}
            isLastMessage={isLastComment}
            previousMessage={previousComment}
            nextMessage={nextComment}
            messages={item.postComments}
            messageEditing={messageEditing}
            // Pass in the post so we can render the `PostRange` content in replies.
            postRoom={item.post}
            jumpState={
                item.postComment &&
                !item.postComment.isOptimistic &&
                jumpToMessageRangeState &&
                jumpToMessageRangeState.options.startIndex <= item.postComment.index &&
                item.postComment.index <= jumpToMessageRangeState.options.endIndex
                    ? jumpToMessageRangeState.messages[
                          item.postComment.index - jumpToMessageRangeState.options.startIndex
                      ]!
                    : null
            }
            onJumpToMessageRange={jumpToMessageRange}
            onJumpToPostRange={jumpToPostRange}
            onReplyToMessage={onReplyToMessage}
            onDeleteMessage={onDeleteMessage}
            disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
            getMessageUrl={messageIndex => {
                return new URL(
                    `/s/${item.post.spaceId}/posts/${item.post.id}?comment=${messageIndex}`,
                    window.location.href,
                );
            }}
            onSetMessageReaction={handleSetMessageReaction}
            onDeleteMessageReaction={handleDeleteMessageReaction}
            onUpdateMessagesOptimistically={onUpdatePostCommentsOptimistically}
            roomDisplayedCreatedTime={item.post.createdTime}
            isReadOnly={isReadOnly}
        />
    );
}
