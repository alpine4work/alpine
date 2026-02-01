import {Check} from "phosphor-react";
import {Node} from "prosemirror-model";
import {Memo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {DocumentCommentThreadPreview} from "~/client/web/documents/internal/document_comment_thread_preview.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
} from "~/client/web/styles/document_shared_styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

export function DocumentCommentThreadHeader({
    commentThread,
    unpersistedIsResolved,
    resolveCommentThread,
    unresolveCommentThread,
    withoutCommentThreadPreview,
    contentSnippet,
    contentReferences,
    onCommentThreadSnippetPress,
    isCommentThreadArchived,
    onArchiveCommentThread,
    onUnarchiveCommentThread,
}: {
    commentThread: DocumentCommentThreadModel;
    unpersistedIsResolved: boolean | null;
    resolveCommentThread: () => Promise<void>;
    unresolveCommentThread: () => Promise<void>;
    withoutCommentThreadPreview: boolean;
    contentSnippet: Node | null;
    contentReferences: DocumentContentReferences;
    onCommentThreadSnippetPress: (commentThreadId: DocumentCommentThreadId) => void;
    isCommentThreadArchived?: Memo<(commentThreadId: DocumentCommentThreadId) => boolean>;
    onArchiveCommentThread?: Memo<(commentThreadId: DocumentCommentThreadId) => MaybePromise<void>>;
    onUnarchiveCommentThread?: Memo<
        (commentThreadId: DocumentCommentThreadId) => MaybePromise<void>
    >;
}) {
    const reporter = useReporter();

    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isPending, setIsPending] = useState(false);

    // `commentThread` is updated in realtime when resolution state changes and is
    // persisted. However, our document collaboration service may be ahead of
    // what's persisted. We want to show the latest unpersisted resolution state as
    // a convenience and rely on `commentThread` to have the correct state.
    const isResolved = unpersistedIsResolved ?? commentThread.isResolved;

    const handlePress = () => {
        setIsPending(true);

        const promise = isResolved ? unresolveCommentThread() : resolveCommentThread();

        promise.then(
            () => {
                setIsPending(false);
            },
            error => {
                setIsPending(false);

                reporter.displayError(
                    isResolved
                        ? "Couldn\u2019t mark as unresolved"
                        : "Couldn\u2019t mark as resolved",
                    error,
                );
            },
        );

        // Reward the user with haptic feedback when they resolve a comment thread.
        NativeMobileBridge?.haptic.playLightImpact();
    };

    const {isPressed, pressProps} = usePress({
        onPress: handlePress,
    });

    return (
        <>
            <Box
                height={documentCommentThreadActionsHeight}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
            >
                <Box display="flex" alignItems="center">
                    <IconButton
                        ref={buttonRef}
                        variant={isResolved ? "accent" : "outline"}
                        description="Mark as resolved"
                        withoutTooltip={true}
                        isPressed={isPressed}
                        isPending={isPending}
                        onPress={handlePress}
                    >
                        <Check size={spacing["4"]} weight={isResolved ? "bold" : undefined} />
                    </IconButton>
                    <Box
                        // Not focusable since the `<IconButton>` is focusable.
                        {...pressProps}
                        alignSelf="stretch"
                        display="flex"
                        alignItems="center"
                        paddingLeft="2"
                        fontStyle="semi-bold"
                    >
                        {isResolved ? "Resolved" : "Mark as resolved"}
                    </Box>
                </Box>
                {isCommentThreadArchived && (
                    <Button
                        variant={
                            isCommentThreadArchived(commentThread.id)
                                ? "neutral-disabled"
                                : "neutral"
                        }
                        height="6"
                        paddingX="2"
                        icon={<Check />}
                        pressErrorTitle="Can&#x2019;t mark as done"
                        onPress={async () => {
                            if (isCommentThreadArchived(commentThread.id)) {
                                await onUnarchiveCommentThread?.(commentThread.id);
                            } else {
                                await onArchiveCommentThread?.(commentThread.id);
                            }
                        }}
                    >
                        Done
                    </Button>
                )}
            </Box>
            {!withoutCommentThreadPreview && (
                <>
                    <Spacer space={documentCommentThreadHeaderPaddingY} />
                    <DocumentCommentThreadPreview
                        commentThread={commentThread}
                        unpersistedIsResolved={unpersistedIsResolved}
                        contentSnippet={contentSnippet}
                        contentReferences={contentReferences}
                        onCommentThreadSnippetPress={onCommentThreadSnippetPress}
                        isResolveButtonPending={isPending}
                    />
                </>
            )}
        </>
    );
}
