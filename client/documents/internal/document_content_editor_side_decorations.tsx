import {ChatCircleText} from "phosphor-react";
import {RefObject, useLayoutEffect, useMemo, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {ContentEditorRef} from "~/client/content/content_editor";
import {Box} from "~/client/design/box";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useClientInfo} from "~/client/remix/client_info_context";
import {convertRemLengthToPx} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {assertId} from "~/shared/id/id";
import {AccountId, DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {DocumentContentWithReferences} from "~/shared/models/document_model";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer";
import {colorSchemeVars, contentSchemaStyles} from "~/shared/styles/styles";

// We render side decorations with a React component instead of ProseMirror
// decorations or custom node views both because we want interactive React
// components instead of plain DOM elements and we get more control
// over positioning.
export function DocumentContentEditorSideDecorations({
    containerRef,
    containerSize,
    editorRef,
    content,
}: {
    containerRef: RefObject<HTMLDivElement>;
    containerSize: {width: number; height: number} | null;
    editorRef: RefObject<ContentEditorRef>;
    content: DocumentContentWithReferences;
}) {
    const isInitialAppRender = useIsInitialAppRender();

    // We don't server-side render side decorations since we absolutely position
    // them and need the mounted editor to figure out the coordinates for that.
    if (isInitialAppRender) return null;

    return (
        <DocumentContentEditorSideDecorationsInner
            containerRef={containerRef}
            containerSize={containerSize}
            editorRef={editorRef}
            content={content}
        />
    );
}

function DocumentContentEditorSideDecorationsInner({
    containerRef,
    containerSize,
    editorRef,
    content,
}: {
    containerRef: RefObject<HTMLDivElement>;
    containerSize: {width: number; height: number} | null;
    editorRef: RefObject<ContentEditorRef>;
    content: DocumentContentWithReferences;
}) {
    const [decorationByMarkTop, setDecorationByMarkTop] = useState<
        ReadonlyMap<
            number,
            {
                readonly markHeight: number;
                readonly commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
            }
        >
    >(() => new Map());

    const {windowWidth} = useClientInfo();
    const remPx = useRemPx();
    const commentCountMinMargin = convertRemLengthToPx("2.75rem", remPx);
    const commentAvatarsMinMargin = convertRemLengthToPx("6.75rem", remPx);
    const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);

    const shouldRenderCommentCount =
        Math.max(0, (containerSize?.width ?? windowWidth) - blockMaxWidth) / 2 >=
        commentCountMinMargin;

    const shouldRenderCommentAvatars =
        Math.max(0, (containerSize?.width ?? windowWidth) - blockMaxWidth) / 2 >=
        commentAvatarsMinMargin;

    useLayoutEffect(() => {
        // If we are not rendering comment counts, don't bother traversing our content
        // collecting decorations.
        if (!shouldRenderCommentCount) {
            return setDecorationByMarkTop(previousDecorationByMarkTop => {
                if (previousDecorationByMarkTop.size === 0) return previousDecorationByMarkTop;
                return new Map();
            });
        }

        const run = () => {
            const containerElement = assertExists(containerRef.current);
            const editor = assertExists(editorRef.current);

            const {decorationByMarkTop} = collectDecorationByMarkTop(
                {
                    containerRect: containerElement.getBoundingClientRect(),
                    editor,
                    seenCommentThreadIds: new Set(),
                    decorationByMarkTop: new Map(),
                },
                content.doc,
            );

            setDecorationByMarkTop(previousDecorationByMarkTop => {
                // Often the document will change but our decorations will not change. Do not
                // re-render the component if our decorations did not change.
                if (isDeepEqual(previousDecorationByMarkTop, decorationByMarkTop))
                    return previousDecorationByMarkTop;

                return decorationByMarkTop;
            });
        };

        // Run in a microtask so the parent ref can populate.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [containerRef, content.doc, editorRef, shouldRenderCommentCount]);

    const suffixByKey = new Map<string, {suffix: number}>();

    return (
        <>
            {mapIterable(decorationByMarkTop, ([markTop, decoration]) => {
                const key = Array.from(decoration.commentThreadIds).join("-");

                // Comment thread could appear on multiple paragraphs. Add a suffix to
                // uniquify it.
                const keySuffix = getOrSetDefaultMapValue(suffixByKey, key, () => ({suffix: 0}))
                    .suffix++;

                return (
                    <DocumentContentEditorCommentThreadSideDecoration
                        key={`${key}-${keySuffix}`}
                        content={content}
                        markTop={markTop}
                        markHeight={decoration.markHeight}
                        commentThreadIds={decoration.commentThreadIds}
                        shouldRenderCommentAvatars={shouldRenderCommentAvatars}
                    />
                );
            })}
        </>
    );
}

const collectDecorationByMarkTop = createProsemirrorIncrementalReducer<{
    containerRect: DOMRect;
    editor: ContentEditorRef;
    seenCommentThreadIds: Set<DocumentCommentThreadId>;
    decorationByMarkTop: Map<
        number,
        {markHeight: number; commentThreadIds: Set<DocumentCommentThreadId>}
    >;
}>(node => {
    const commentThreadIds = filterMapArray(node.marks, mark => {
        if (mark.type.name !== "comment") return null;
        return assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId);
    });

    if (commentThreadIds.length === 0) return null;

    return (state, doc, offset) => {
        const coords = state.editor.coordsAtPos(offset);
        const markTop = coords.top - state.containerRect.top;
        const markHeight = coords.bottom - coords.top;

        for (const commentThreadId of commentThreadIds) {
            if (state.seenCommentThreadIds.has(commentThreadId)) continue;

            const decoration = getOrSetDefaultMapValue(state.decorationByMarkTop, markTop, () => ({
                markHeight,
                commentThreadIds: new Set<DocumentCommentThreadId>(),
            }));

            state.seenCommentThreadIds.add(commentThreadId);
            decoration.commentThreadIds.add(commentThreadId);
        }

        return state;
    };
});

function DocumentContentEditorCommentThreadSideDecoration({
    content,
    markTop,
    markHeight,
    commentThreadIds,
    shouldRenderCommentAvatars,
}: {
    content: DocumentContentWithReferences;
    markTop: number;
    markHeight: number;
    commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
    shouldRenderCommentAvatars: boolean;
}) {
    const {commentCount, commentAuthors} = useMemo(() => {
        let commentCount = 0;
        const commentAuthorById = new Map<AccountId, AccountModel>();

        for (const commentThreadId of commentThreadIds) {
            const commentThread = content.references.commentThreadById.get(commentThreadId);
            if (!commentThread) continue;

            commentCount += commentThread.commentCount;

            for (const account of commentThread.commentAuthors)
                commentAuthorById.set(account.id, account);
        }

        return {
            commentCount,
            commentAuthors: Array.from(commentAuthorById.values()),
        };
    }, [commentThreadIds, content.references.commentThreadById]);

    return (
        <Box
            position="absolute"
            display="flex"
            alignItems="center"
            gap="2"
            paddingRight="0.5"
            style={{
                top: markTop,
                right: `calc(50% + ${contentSchemaStyles.blockMaxWidth} / 2)`,
                height: markHeight,
            }}
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
