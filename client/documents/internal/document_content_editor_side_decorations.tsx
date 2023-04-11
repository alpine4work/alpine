import {ChatCircleText} from "phosphor-react";
import {useMemo} from "react";
import {usePress} from "react-aria";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {Box} from "~/client/design/box";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {useClientInfo} from "~/client/remix/client_info_context";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {AccountId, DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {DocumentContentReferences} from "~/shared/models/document_model";
import {colorSchemeVars, contentSchemaStyles} from "~/shared/styles/styles";

export type DocumentContentEditorSideDecoration = {
    readonly markTop: number;
    readonly markHeight: number;
    readonly commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
};

// We render side decorations with a React component instead of ProseMirror
// decorations or custom node views both because we want interactive React
// components instead of plain DOM elements and we get more control
// over positioning.
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
    const remPx = useRemPx();
    const commentCountMinMargin = convertRemLengthToPx("2.75rem", remPx);
    const commentAvatarsMinMargin = convertRemLengthToPx("6.75rem", remPx);
    const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);

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
                const key = Array.from(decoration.commentThreadIds).join("-");

                // Comment thread could appear on multiple paragraphs. Add a suffix to
                // uniquify it.
                const keySuffix = getOrSetDefaultMapValue(suffixByKey, key, () => ({suffix: 0}))
                    .suffix++;

                return (
                    <DocumentContentEditorCommentThreadSideDecoration
                        key={`${key}-${keySuffix}`}
                        contentReferences={contentReferences}
                        markTop={decoration.markTop}
                        markHeight={decoration.markHeight}
                        commentThreadIds={decoration.commentThreadIds}
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
            // TODO(calebmer): Global navigation loading indicator?
            const commentThreadId = commentThreadIds.values().next().value;
            if (commentThreadId) void openCommentThread(commentThreadId);
        },
    });

    // Don't show decoration when there are no comments.
    if (commentCount === 0 || commentAuthors.length === 0) return null;

    return (
        <Box
            position="absolute"
            display="flex"
            alignItems="center"
            gap="2"
            paddingRight="0.5"
            borderRadius="md"
            style={{
                top: markTop,
                right: `calc(50% + ${contentSchemaStyles.blockMaxWidth} / 2)`,
                height: markHeight,
                opacity: isPressed ? 0.75 : undefined,
            }}
            {...pressProps}
        >
            <Box display="flex" alignItems="center" gap="0.5" color="grey-40">
                <ChatCircleText size="0.825rem" color={colorSchemeVars["grey-30"]} />
                {commentCount <= 99 ? commentCount : "99+"}
            </Box>
            {shouldRenderCommentAvatars && (
                <AccountAvatarPile
                    size="4"
                    previewAccounts={commentAuthors.slice(0, 3)}
                    accountCount={commentAuthors.length}
                    getAllAccounts={() => commentAuthors}
                />
            )}
        </Box>
    );
}
