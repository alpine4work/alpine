import {SearchInjectionContextModule} from "~/server/context/injection_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {addSpaceAccountWithoutAuthorization} from "~/server/spaces/internal/add_space_account_without_authorization.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {defaultSpaceThemeColor} from "~/shared/design/core/theme_colors.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export async function seedTestSpaces(
    context: Context<
        DynamoContextModules & {
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, adminAccountId} = getDynamoSeedConstants();

    await SpacesTable.createItemIfNoneExists(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId: defaultSpaceId,
        name: "Test",
        createdTime: new Date(),
        themeColor: defaultSpaceThemeColor,
    });

    const spaceAccountItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Space",
        sortRangeType: "Account",
        spaceId: defaultSpaceId,
        accountId: adminAccountId,
    });

    if (!spaceAccountItem || spaceAccountItem.state.type !== "Active") {
        try {
            await addSpaceAccountWithoutAuthorization(
                context.clone({cache: CacheContextModule.new()}),
                {
                    spaceId: defaultSpaceId,
                    accountId: adminAccountId,
                    // make default space account as "Owner" since it is the first account in the
                    // space.
                    role: "Owner",
                    inviterAccountId: null,
                },
            );
        } catch (error) {
            // Ignore account is already a member of space error. Since this means due to a
            // race condition we tried to add the account to the space twice.
            if (
                error instanceof FailedPreconditionError &&
                error.message.includes("Account is already a member of space")
            ) {
                return;
            }

            throw error;
        }
    }
}
