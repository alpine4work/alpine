import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {addSpaceAccountWithoutAuthorization} from "~/server/spaces/internal/add_space_account_without_authorization.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpaceAccountItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {defaultSpaceThemeColor} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
        themeColor: defaultSpaceThemeColor,
    });
}

/**
 * Create a space in a test environment with a linked email domain.
 */
export async function createSpaceWithAutoAddAccountsFromEmailDomainForTest(
    context: DynamoContext,
    {
        id = generateId<SpaceId>(),
        name,
        emailDomain,
        isDisabled = false,
    }: {
        id?: SpaceId;
        name: string;
        emailDomain: string;
        isDisabled?: boolean;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    await DynamoTableSchema.executeTransaction(context, [
        SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: id,
            name,
            createdTime: new Date(),
            themeColor: defaultSpaceThemeColor,
        }),
        SpacesTable.transactionCreateOrReplaceItem({
            partitionType: "Space",
            sortRangeType: "AutoAddAccountsFromEmailDomain",
            spaceId: id,
            emailDomain,
        }),
        SpacesTable.transactionCreateItem({
            partitionType: "AutoAddAccountsFromEmailDomain",
            sortRangeType: "Space",
            emailDomain,
            spaceId: id,
            isEnabled: !isDisabled,
        }),
    ]);
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
        overrideCurrentTime,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
        overrideCurrentTime?: Date;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    await addSpaceAccountWithoutAuthorization(
        process.env.NODE_ENV === "development"
            ? context.clone({cache: CacheContextModule.new()})
            : context.clone({
                  cache: CacheContextModule.new(),
              }),
        {
            spaceId,
            accountId,
            role,
            inviterAccountId: null,
            overrideCurrentTimeForTest: overrideCurrentTime,
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

    return await getSpaceAccountItemIfExists(context, spaceId, accountId);
}
