import {Box} from "~/client/design/box.js";
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
        <>
            {results.map(result => {
                return (
                    <Box key={result.entityId} padding="2">
                        <Box>{result.title}</Box>
                        <Box>{result.bodyHighlight}</Box>
                    </Box>
                );
            })}
        </>
    );
}
