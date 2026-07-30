import {Memo, useCallback, useMemo} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {SubscribeToSpellCheckIgnoredLintEventsFunction} from "~/client/web/documents/use_document_content_editor_web_socket.js";
import {useRynamoQuery} from "~/client/web/dynamo/use_rynamo_query.js";
import {RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {
    backfillSpellCheckIgnoredLints,
    getSpellCheckIgnoredLints,
} from "~/shared/rpc/spell_check_rpc_definitions.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export function useDocumentContentEditorSpellCheckIgnoredLints({
    documentId,
    initialSpellCheckIgnoredLints,
    isConnected,
    subscribeToSpellCheckIgnoredLintEvents,
    subscribeToPongs,
}: {
    documentId: DocumentId;
    initialSpellCheckIgnoredLints: RynamoQueryResult<SpellCheckIgnoredLintModel>;
    isConnected: boolean;
    subscribeToSpellCheckIgnoredLintEvents: SubscribeToSpellCheckIgnoredLintEventsFunction;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
}) {
    const context = useAppContext();

    const {query: spellCheckIgnoredLintsQuery, handleEvent: handleEventForSpellCheckIgnoredLint} =
        useRynamoQuery(initialSpellCheckIgnoredLints, {
            isConnected,
            subscribeToEvents: subscribeToSpellCheckIgnoredLintEvents,
            subscribeToPongs,
            backfillQuery: useCallback(
                async checkpoint => {
                    const {result} = await backfillSpellCheckIgnoredLints(context, {
                        entityId: `Document:${documentId}`,
                        checkpoint,
                    });
                    return result;
                },
                [context, documentId],
            ),
            reloadQuery: useCallback(async () => {
                const result = await getSpellCheckIgnoredLints(context, {
                    entityId: `Document:${documentId}`,
                });
                return result.spellCheckIgnoredLints;
            }, [context, documentId]),
        });

    const spellCheckIgnoredLints: ReadonlyArray<{key: string; kind: string}> = useMemo(() => {
        const newSpellCheckIgnoredLints: Array<{key: string; kind: string}> = [];

        for (
            let i = 0;
            i < spellCheckIgnoredLintsQuery.getItemCountWithoutLoadingIndicator();
            i++
        ) {
            const item = spellCheckIgnoredLintsQuery.getItem(i);
            if (item.type !== "Loaded") continue;

            newSpellCheckIgnoredLints.push({
                key: item.item.model.key,
                kind: item.item.model.kind,
            });
        }

        return newSpellCheckIgnoredLints;
    }, [spellCheckIgnoredLintsQuery]);

    return {
        spellCheckIgnoredLints,
        handleEventForSpellCheckIgnoredLint,
    };
}
