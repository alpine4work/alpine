import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/dynamo/accounts_table";
import {AuthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContextModules} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError, PermissionDeniedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {AccountId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

/**
 * An empty system context module has no capabilities of the dangerous system
 * context module and is used to prevent users from calling
 * `context.clone({system: new DangerousSystemContextModule()})`.
 */
export class EmptySystemContextModule extends ContextModuleBase {
    public authorizeSystemAccess(): void {
        throw new PermissionDeniedError("Context does not have system access");
    }
}

/**
 * Context module for performing system-level actions in a trusted environment.
 * For instance, allows impersonating any account to perform an action as them!
 * You should be careful about how you use this capability.
 */
export class DangerousSystemContextModule
    extends ContextModuleBase<ProcessContextModules>
    implements EmptySystemContextModule
{
    public authorizeSystemAccess(): void {
        // noop
    }

    /**
     * Create a `RequestContext` impersonating some account. Allows us to perform
     * actions on behalf of an account in the backend outside a direct interaction
     * from the account.
     */
    public impersonateAccount<Modules extends ProcessContextModules>(
        this: DangerousSystemContextModule & ContextModuleBase<Modules>,
        accountId: AccountId,
    ): RequestContext {
        return this._context.clone({
            // Block usage of `DangerousSystemContextModule` in the child request context.
            // If someone tries to call `impersonateAccount()` it will error.
            system: new SystemImpersonatedAccountContextModule(),
            // Our cache is scoped to a request which has an associated account. There is
            // no cross-account cache on the context.
            cache: new CacheContextModule(),
            auth: new SystemImpersonatedAccountAuthContextModule(accountId),
        });
    }
}

class SystemImpersonatedAccountContextModule extends DangerousSystemContextModule {
    public override authorizeSystemAccess(): void {
        throw new PermissionDeniedError("Context does not have system access");
    }

    public override impersonateAccount<Modules extends ProcessContextModules>(
        this: DangerousSystemContextModule & ContextModuleBase<Modules>,
        accountId: AccountId,
    ): RequestContext {
        throw new InternalError("Can not impersonate account from an impersonated account context");
    }
}

// IMPORTANT: Should not be exported! Only `DangerousSystemContextModule` should
// be allowed to construct this class.
//
// To get an authenticated context module you should use
// `AuthenticatedSessionAuthContextModule`.
class SystemImpersonatedAccountAuthContextModule
    extends ContextModuleBase<{
        tracer: TracerContextModule;
        dynamo: DynamoContextModule;
    }>
    implements AuthenticatedAuthContextModule
{
    private readonly _accountId: AccountId;
    private _accountPromiseRef: {current: Promise<AccountModel> | null} = {current: null};

    constructor(accountId: AccountId) {
        super();
        this._accountId = accountId;
    }

    public getAccountId(): AccountId {
        return this._accountId;
    }

    public getAccount(): Promise<AccountModel> {
        if (!this._accountPromiseRef.current) {
            this._accountPromiseRef.current = (async () => {
                const account = await dangerouslyGetAccountIfExistsWithoutAuthorization(
                    this._context,
                    this._accountId,
                );
                assert(account, "Can not find system impersonated account");
                return account;
            })();
        }

        return this._accountPromiseRef.current;
    }
}
