import {dangerouslyUpdateAccountPlan} from "~/server/accounts/dangerously_update_account_plan.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";

const context = createTestContext();

describe("dangerouslyUpdateAccountPlan()", () => {
    test("should update account plan from undefined to LifetimeAccess", async () => {
        const account = await TestAccount.create(context);

        // Verify initial plan is undefined
        const initialItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(initialItem?.plan).toBe(undefined);

        // Update the plan to LifetimeAccess
        await dangerouslyUpdateAccountPlan(context, account.id, "LifetimeAccess");

        // Verify the plan was updated
        const updatedItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(updatedItem?.plan).toBe("LifetimeAccess");
    });

    test("should update account plan from LifetimeAccess to undefined", async () => {
        const account = await TestAccount.create(context);

        // First set the plan to LifetimeAccess
        await dangerouslyUpdateAccountPlan(context, account.id, "LifetimeAccess");

        // Verify it was set
        let item = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(item?.plan).toBe("LifetimeAccess");

        // Update the plan back to undefined
        await dangerouslyUpdateAccountPlan(context, account.id, undefined);

        // Verify the plan was updated
        item = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(item?.plan).toBe(undefined);
    });

    test("should not modify item when plan is already the target value", async () => {
        const account = await TestAccount.create(context);

        // Set initial plan
        await dangerouslyUpdateAccountPlan(context, account.id, "LifetimeAccess");

        // Get the item after first update
        const itemAfterFirstUpdate = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(itemAfterFirstUpdate?.plan).toBe("LifetimeAccess");

        // Try to update to the same plan
        await dangerouslyUpdateAccountPlan(context, account.id, "LifetimeAccess");

        // Verify the item is unchanged (same reference means it wasn't updated)
        const itemAfterSecondUpdate = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        });
        expect(itemAfterSecondUpdate?.plan).toBe("LifetimeAccess");
    });
});
