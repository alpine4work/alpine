import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    ApiTaskCollectionResponse,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {MaybeReadonlyArray} from "~/shared/helpers/types/maybe_array.js";

export type StoreAgentWebPageLinkForTestTarget =
    | ApiTaskCollectionResponse
    | ApiTaskWithoutNotesResponse;

/**
 * Store pathnames for various API response objects so that we can call tools like
 * `read` and `update` on them later.
 */
export async function storeAgentWebPageLinkForTest(
    storage: AgentWebSessionStorage,
    ...targets: NonEmptyReadonlyArray<MaybeReadonlyArray<StoreAgentWebPageLinkForTestTarget>>
) {
    assert(process.env.NODE_ENV === "test");

    const pageLinks = mapIterable(
        flatMapIterable(targets, target => (isReadonlyArray(target) ? target : [target])),
        (target): AgentWebPageStoredLink => {
            if ("collections" in target) {
                return {
                    type: "Task",
                    id: target.id,
                    title: target.title,
                    status: target.status,
                };
            } else if ("defaults" in target) {
                return {
                    type: "TaskCollection",
                    id: target.id,
                    title: target.name,
                };
            } else {
                throw exhaustive(target);
            }
        },
    );

    await runAllPromises(
        mapIterable(pageLinks, pageLink => createAgentWebPageStoredLinkPathname(storage, pageLink)),
    );
}
