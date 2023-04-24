import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {SessionActionContext} from "~/server/dynamo/context/action_context";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {PermissionDeniedError, UnimplementedError} from "~/shared/error/error";
import {AccountId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

class MyAccountDurableObject {
    public static readonly serviceName = "MyAccountService";

    private readonly _processContext: ProcessContext;
    private readonly _accountId: AccountId;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: ProcessContext;
        initializeActionContext: SessionActionContext;
        idName: string;
    }): Promise<MyAccountDurableObject> {
        const accountId = Schema.id<AccountId>().deserialize(idName);

        if (initializeActionContext.actor.getAccountId() !== accountId) {
            throw new PermissionDeniedError(
                "Can only access the durable object for your own account",
            );
        }

        return new MyAccountDurableObject({
            processContext,
            accountId,
        });
    }

    private constructor({
        processContext,
        accountId,
    }: {
        processContext: ProcessContext;
        accountId: AccountId;
    }) {
        // Propagate the `AccountId` to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {accountId}});

        this._processContext = processContext;
        this._accountId = accountId;
    }

    public async fetch(context: SessionActionContext, request: Request): Promise<Response> {
        if (context.actor.getAccountId() !== this._accountId) {
            throw new PermissionDeniedError(
                "Can only access the durable object for your own account",
            );
        }

        // Propagate the `AccountId` to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {accountId: this._accountId},
        });

        throw new UnimplementedError("TODO");
    }
}

const MyAccountDurableObjectWrapper = createDurableObject(MyAccountDurableObject);
export {MyAccountDurableObjectWrapper as MyAccountDurableObject};
