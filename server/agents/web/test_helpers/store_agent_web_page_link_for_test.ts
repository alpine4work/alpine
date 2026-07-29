import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountResponse,
    ApiMentionReferenceResponse,
    ApiTaskCollectionPreviewResponse,
    ApiTaskCollectionResponse,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {MaybeReadonlyArray} from "~/shared/helpers/types/maybe_array.js";

export type StoreAgentWebPageLinkForTestTarget =
    | ApiAccountResponse
    | ApiTaskCollectionPreviewResponse
    | ApiTaskCollectionResponse
    | ApiTaskResponse
    | ApiMentionReferenceResponse;

/**
 * Store pathnames for various API response objects so that we can call tools like
 * `read` and `update` on them later. We use duck typing to determine the type of
 * each target and then convert them into `AgentWebPageStoredLink` objects.
 */
export function storeAgentWebPageLinkForTest(
    storage: AgentWebSessionStorage,
    target: StoreAgentWebPageLinkForTestTarget,
): Promise<string>;
export function storeAgentWebPageLinkForTest<
    const Targets extends ReadonlyArray<StoreAgentWebPageLinkForTestTarget>,
>(
    storage: AgentWebSessionStorage,
    targets: Targets,
): Promise<{readonly [Index in keyof Targets]: string}>;
export function storeAgentWebPageLinkForTest<
    const Targets extends [
        StoreAgentWebPageLinkForTestTarget,
        StoreAgentWebPageLinkForTestTarget,
        ReadonlyArray<StoreAgentWebPageLinkForTestTarget>,
    ],
>(
    storage: AgentWebSessionStorage,
    ...targets: Targets
): Promise<{readonly [Index in keyof Targets]: string}>;
export async function storeAgentWebPageLinkForTest(
    storage: AgentWebSessionStorage,
    ...targets: NonEmptyReadonlyArray<MaybeReadonlyArray<StoreAgentWebPageLinkForTestTarget>>
): Promise<string | ReadonlyArray<string>> {
    assert(process.env.NODE_ENV === "test");

    const pageLinks = mapIterable(
        flatMapIterable(targets, target => (isReadonlyArray(target) ? target : [target])),
        (target): AgentWebPageStoredLink => {
            if ("shortName" in target) {
                if ("name" in target) {
                    return intoApiAccountReference(target);
                } else {
                    return target;
                }
            }

            if ("collections" in target) {
                return {
                    type: "Task",
                    id: target.id,
                    title: target.title,
                    status: target.status,
                };
            }

            if ("name" in target) {
                return {
                    type: "TaskCollection",
                    id: target.id,
                    title: target.name,
                };
            }

            // In this `else` branch, the only remaining possibility should be a
            // `ApiMentionReferenceResponse`. Other cases should be handled above.
            return cast<ApiMentionReferenceResponse>(target);
        },
    );

    const pathnames = await runAllPromises(
        mapIterable(pageLinks, pageLink => createAgentWebPageStoredLinkPathname(storage, pageLink)),
    );

    return targets.length === 1 && !isReadonlyArray(targets[0]) ? pathnames[0]! : pathnames;
}
