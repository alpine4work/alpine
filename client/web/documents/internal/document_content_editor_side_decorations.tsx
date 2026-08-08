import {useMemo} from "react";
import {usePress} from "react-aria";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {Box} from "~/client/web/design/box.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {addRemLengths, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {AccountId, DocumentCommentThreadId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type DocumentContentEditorSideDecoration = {
    readonly markTop: number;
    readonly markHeight: number;

    /**
     * Every comment thread anchored at this position, including threads whose marks
     * are hidden inside a collapsed heading section. The sidebar's previous/next
     * navigation uses this set so hidden threads stay reachable.
     */
    readonly commentThreadIds: ReadonlySet<DocumentCommentThreadId>;

    /**
     * The subset of `commentThreadIds` that renders a preview in the margin: threads
     * whose marks are hidden inside a collapsed section, or on a collapsed heading
     * itself (where the expand chevron sits), don't.
     */
    readonly visibleCommentThreadIds: ReadonlySet<DocumentCommentThreadId>;
};

// We render side decorations with a React component instead of ProseMirror
// decorations or custom node views both because we want interactive React
// components instead of plain DOM elements and we get more control over
// positioning.
export function DocumentContentEditorSideDecorations({
    editorContainerWidth,
    contentReferences,
    decorations,
    openCommentThread,
}: {
    editorContainerWidth: number | null;
    contentReferences: DocumentContentReferences;
    decorations: ReadonlyArray<DocumentContentEditorSideDecoration>;
    openCommentThread: (commentThreadId: DocumentCommentThreadId) => Promise<void>;
}) {
    const {screenWidth} = useClientInfo();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const commentCountMinMargin = convertRemLengthToPx("2.25rem", spacingScale);
    const commentAvatarsMinMargin = convertRemLengthToPx("6.25rem", spacingScale);
    const blockMaxWidth = convertRemLengthToPx(contentStyles.blockMaxWidth[platform], spacingScale);

    const shouldRenderCommentCount =
        Math.max(0, (editorContainerWidth ?? screenWidth) - blockMaxWidth) / 2 >=
        commentCountMinMargin;

    const shouldRenderCommentAvatars =
        Math.max(0, (editorContainerWidth ?? screenWidth) - blockMaxWidth) / 2 >=
        commentAvatarsMinMargin;

    const suffixByKey = new Map<string, {suffix: number}>();

    if (!shouldRenderCommentCount) return null;

    return (
        <>
            {decorations.map(decoration => {
                // Comment threads hidden inside a collapsed heading section don't render a
                // preview. They stay in `commentThreadIds` so the sidebar's previous/next
                // navigation still reaches them.
                if (decoration.visibleCommentThreadIds.size === 0) return null;

                const key = Array.from(decoration.visibleCommentThreadIds).join("-");

                // Comment thread could appear on multiple paragraphs. Add a suffix to uniquify it.
                const keySuffix = getOrSetDefaultMapValue(suffixByKey, key, () => ({suffix: 0}))
                    .suffix++;

                return (
                    <DocumentContentEditorCommentThreadSideDecoration
                        key={`${key}-${keySuffix}`}
                        contentReferences={contentReferences}
                        markTop={decoration.markTop}
                        markHeight={decoration.markHeight}
                        commentThreadIds={decoration.visibleCommentThreadIds}
                        shouldRenderCommentAvatars={shouldRenderCommentAvatars}
                        openCommentThread={openCommentThread}
                    />
                );
            })}
        </>
    );
}

function DocumentContentEditorCommentThreadSideDecoration({
    contentReferences,
    markTop,
    markHeight,
    commentThreadIds,
    shouldRenderCommentAvatars,
    openCommentThread,
}: {
    contentReferences: DocumentContentReferences;
    markTop: number;
    markHeight: number;
    commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
    shouldRenderCommentAvatars: boolean;
    openCommentThread: (commentThreadId: DocumentCommentThreadId) => Promise<void>;
}) {
    const platform = usePlatform();

    const {commentCount, commentAuthors} = useMemo(() => {
        let commentCount = 0;
        const commentAuthorById = new Map<AccountId, AccountModel>();

        for (const commentThreadId of commentThreadIds) {
            const commentThread = contentReferences.commentThreadById.get(commentThreadId);
            if (!commentThread) continue;

            commentCount += commentThread.commentCount;

            for (const account of commentThread.commentAuthors)
                commentAuthorById.set(account.id, account);
        }

        return {
            commentCount,
            commentAuthors: Array.from(commentAuthorById.values()),
        };
    }, [commentThreadIds, contentReferences.commentThreadById]);

    const {pressProps, isPressed} = usePress({
        onPress: () => {
            const commentThreadId = commentThreadIds.values().next().value;
            if (commentThreadId) void openCommentThread(commentThreadId);
        },
    });

    // Don't show decoration when there are no comments.
    if (commentCount === 0 || commentAuthors.length === 0) return null;

    return (
        <Box
            data-testid={`DocumentContentEditorCommentThreadSideDecoration:${Array.from(
                commentThreadIds,
            ).join(",")}`}
            position="absolute"
            display="flex"
            alignItems="center"
            gap="1.5"
            paddingRight="0.5"
            borderRadius="1.5"
            style={{
                top: markTop,
                right: `calc(50% + ${addRemLengths(
                    contentStyles.blockMaxWidth[platform],
                    "4",
                )} / 2)`,
                height: markHeight,
                opacity: isPressed ? "60" : undefined,
            }}
            {...pressProps}
        >
            {shouldRenderCommentAvatars && (
                <AccountAvatarPile
                    size="5"
                    previewAccounts={commentAuthors.slice(0, 3)}
                    accountCount={commentAuthors.length}
                    getAllAccounts={() => commentAuthors}
                />
            )}
            <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                width="5"
                height="5"
                color="grey-70"
                backgroundColor="grey-5-translucent"
                borderRadius="full"
                borderBottomRightRadius="none"
                fontSize="50"
            >
                {commentCount <= 99 ? commentCount : "99+"}
            </Box>
        </Box>
    );
}
