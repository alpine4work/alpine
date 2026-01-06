import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {addSpaceAccountWithoutAuthorization} from "~/server/spaces/internal/add_space_account_without_authorization.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpaceAccountItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Create a space in a test environment.
 */
export async function createSpaceForTest(
    context: DynamoContext,
    {id = generateId<SpaceId>(), name}: {id?: SpaceId; name: string},
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    await SpacesTable.createItem(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId: id,
        name,
        createdTime: new Date(),
    });
}

/**
 * Add an account to a space in a test environment.
 */
export async function addSpaceAccountForTest(
    context: ServerProcessContext,
    {
        spaceId,
        accountId,
        role,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    await addSpaceAccountWithoutAuthorization(
        process.env.NODE_ENV === "development"
            ? context.clone({cache: CacheContextModule.new()})
            : context.clone({
                  cache: CacheContextModule.new(),
                  searchInjection: context.searchInjection.cloneForTest({
                      // Don't add `TaskPersonal` favorite search entity in our test environment.
                      // That would require all server tests taking a dependency on
                      // `//server/search/data`.
                      dangerouslyFavoriteSearchEntityWithoutAuthorization: asyncNoop,
                  }),
              }),
        {
            spaceId,
            accountId,
            role,
            withoutInviteForTest: true,
        },
    );
}

/**
 * Get a space account in a test environment.
 */
export async function getSpaceAccountForTest(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<SpaceAccountItem | null> {
    assert(process.env.NODE_ENV === "test");

    return getSpaceAccountItemIfExists(context, spaceId, accountId);
}
