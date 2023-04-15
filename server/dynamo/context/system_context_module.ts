import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/dynamo/accounts_table";
import {AuthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Replace} from "~/shared/helpers/types/replace";
import {AccountId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

export class SystemContextModule extends ContextModuleBase<{}> {
    public impersonateAccount<
        Modules extends {
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
        },
    >(
        this: ContextModuleBase<Modules> & SystemContextModule,
        accountId: AccountId,
    ): Context<Replace<Modules, {auth: ImpersonatedSystemAuthContextModule}>> {
        return this._context.clone({
            auth: new ImpersonatedSystemAuthContextModule(this, accountId),
        });
    }
}

/**
 * Acts as an authenticated account but really it's an impersonation performed
 * by our system code. Our system is acting on behalf of an actual account.
 */
class ImpersonatedSystemAuthContextModule
    extends ContextModuleBase<{
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
        system: SystemContextModule;
    }>
    implements AuthenticatedAuthContextModule
{
    private readonly _accountId: AccountId;

    constructor(
        // You are required to have a `SystemContextModule` instance to construct
        // this object. It is dangerous for any code other than `SystemContextModule`
        // to construct this!
        systemModule: SystemContextModule,
        accountId: AccountId,
    ) {
        super();
        this._accountId = accountId;
    }

    public getAccountId(): AccountId {
        return this._accountId;
    }

    private readonly _accountPromise = new Lazy(async () => {
        const account = await dangerouslyGetAccountIfExistsWithoutAuthorization(
            this._context,
            this._accountId,
        );
        assert(account, "Can not find system impersonated account");
        return account;
    });

    public getAccount(): Promise<AccountModel> {
        return this._accountPromise.get();
    }
}
