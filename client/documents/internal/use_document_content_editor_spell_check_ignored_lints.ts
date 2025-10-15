import {useCallback, useMemo} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {SubscribeToSpellCheckIgnoredLintEventsFunction} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useDynamoGeneralRealtimeQuery} from "~/client/dynamo/use_dynamo_general_realtime_query.js";
import {DynamoGeneralRealtimeQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {
    backfillSpellCheckIgnoredLints,
    getSpellCheckIgnoredLints,
} from "~/shared/rpc/spell_check_rpc_definitions.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

export function useDocumentContentEditorSpellCheckIgnoredLints({
    documentId,
    initialSpellCheckIgnoredLints,
    isConnected,
    subscribeToSpellCheckIgnoredLintEvents,
}: {
    documentId: DocumentId;
    initialSpellCheckIgnoredLints: DynamoGeneralRealtimeQueryResult<SpellCheckIgnoredLintModel>;
    isConnected: boolean;
    subscribeToSpellCheckIgnoredLintEvents: SubscribeToSpellCheckIgnoredLintEventsFunction;
}) {
    const context = useAppContext();

    const {query: spellCheckIgnoredLintsQuery, handleEvent: handleEventForSpellCheckIgnoredLint} =
        useDynamoGeneralRealtimeQuery(initialSpellCheckIgnoredLints, {
            isConnected,
            subscribeToEvents: subscribeToSpellCheckIgnoredLintEvents,
            backfillQuery: useCallback(
                async ({readTime}) => {
                    const {result} = await backfillSpellCheckIgnoredLints(context, {
                        entityId: `Document:${documentId}`,
                        readTime,
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
