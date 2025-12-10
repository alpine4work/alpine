import {
    createAccountEmailAddressForTest,
    createAccountForTest,
    dangerouslyGetAccountIfExistsWithoutAuthorization,
} from "~/server/accounts/accounts_actions.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

let testAccountCount = 1;

export class TestAccount {
    public readonly context: TestContext;
    public readonly id: AccountId;
    public readonly initialName: string;

    protected constructor(context: TestContext, id: AccountId, initialName: string) {
        this.context = context;
        this.id = id;
        this.initialName = initialName;
    }

    public static getNewName() {
        return `Test Account ${testAccountCount++}`;
    }

    public static async create(
        context: TestContext,
        {
            id = generateId<AccountId>(),
            name = TestAccount.getNewName(),
            hasInternalAccess = false,
            observedTimeZone = defaultTimeZone,
        }: {
            id?: AccountId;
            name?: string;
            hasInternalAccess?: boolean;
            observedTimeZone?: TimeZone | null;
        } = {},
    ) {
        await createAccountForTest(context, {
            id,
            name,
            hasInternalAccess,
            observedTimeZone,
        });

        return new TestAccount(context, id, name);
    }

    /**
     * Get a `TestAccount` helper object for an existing account. In case you
     * didn't create the space with `TestAccount.create()`. Throws an error if
     * the account doesn't already exist.
     */
    public static async get(context: TestContext, accountId: AccountId) {
        const account = await dangerouslyGetAccountIfExistsWithoutAuthorization(
            context.clone({cache: CacheContextModule.new()}),
            accountId,
        );
        if (!account) throw new NotFoundError("Account not found");

        return new TestAccount(context, accountId, account.initialData.name);
    }

    /**
     * Adds an email address to this account. If you call this multiple times then
     * the account will have multiple email addresses it may sign in with.
     */
    public async createEmailAddress(
        emailAddress: string = generateEmailAddressForTest(this),
    ): Promise<EmailAddress> {
        const actualEmailAddress = await validateEmailAddress(this.context, emailAddress);

        await createAccountEmailAddressForTest(this.context, {
            accountId: this.id,
            emailAddress: actualEmailAddress,
            isEmailAddressVerified: true,
        });

        return actualEmailAddress;
    }

    public async get(): Promise<AccountModelWithoutSpace> {
        return assertExists(
            await dangerouslyGetAccountIfExistsWithoutAuthorization(
                this.context.clone({cache: CacheContextModule.new()}),
                this.id,
            ),
        );
    }
}
