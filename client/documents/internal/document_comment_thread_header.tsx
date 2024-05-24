import {Check} from "phosphor-react";
import {Node} from "prosemirror-model";
import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useShowToast} from "~/client/design/toast.js";
import {DocumentCommentThreadPreview} from "~/client/documents/internal/document_comment_thread_preview.js";
import {spacing} from "~/shared/design/spacing.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
} from "~/shared/styles/document_shared_styles.js";

// NOCOMMIT: Integration test comment resolution.
//
// - Make sure snippet survives (including after reload)
// - Make sure it updates in realtime
// - After resolving you can still hit the next button to go to the
//   next comment
//
// Desktop and mobile and peek

export function DocumentCommentThreadHeader({
    withMobileLayout,
    commentThread,
    unpersistedIsResolved,
    resolveCommentThread,
    unresolveCommentThread,
    withoutCommentThreadPreview,
    contentSnippet,
    contentReferences,
    onCommentThreadSnippetPress,
}: {
    withMobileLayout: boolean;
    commentThread: DocumentCommentThreadModel;
    unpersistedIsResolved: boolean | null;
    resolveCommentThread: () => Promise<void>;
    unresolveCommentThread: () => Promise<void>;
    withoutCommentThreadPreview: boolean;
    contentSnippet: Node | null;
    contentReferences: DocumentContentReferences;
    onCommentThreadSnippetPress: (commentThreadId: DocumentCommentThreadId) => void;
}) {
    const showToast = useShowToast();

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

                showToast({
                    type: "Error",
                    title: isResolved ? "Couldn’t mark as unresolved" : "Couldn’t mark as resolved",
                    error,
                });
            },
        );
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
            </Box>
            {!withoutCommentThreadPreview && (
                <>
                    <Spacer space={documentCommentThreadHeaderPaddingY} />
                    <DocumentCommentThreadPreview
                        withMobileLayout={withMobileLayout}
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
