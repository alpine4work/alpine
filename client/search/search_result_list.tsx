import {useCallback} from "react";
import {SearchResultView, minSearchResultViewHeight} from "~/client/search/search_result_view.js";
import {VirtualizedScrollView} from "~/client/virtualized/virtualized_scroll_view.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";

export function SearchResultList({
    results,
}: {
    results: ReadonlyArray<{
        readonly entityId: SearchEntityId;
        readonly title: string | null;
        readonly bodyHighlight: string | null;
    }>;
}) {
    return (
        <VirtualizedScrollView
            itemCount={results.length}
            bufferedItemHeight={minSearchResultViewHeight}
            renderItem={useCallback(
                (index: number) => {
                    const result = results[index]!;

                    const isFirstEntry = index === 0;
                    const isLastEntry = index === results.length - 1;

                    return {
                        key: result.entityId,
                        minHeight: minSearchResultViewHeight,
                        node: (
                            <SearchResultView
                                result={result}
                                isFirstEntry={isFirstEntry}
                                isLastEntry={isLastEntry}
                            />
                        ),
                    };
                },
                [results],
            )}
        />
    );
}
