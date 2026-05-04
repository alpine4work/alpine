import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * An implementation of `EdgeServiceContextModuleBase` for tests that records edge
 * service calls so tests can inspect them.
 */
export class TestLocalEdgeServiceContextModule
    extends ContextModuleBase
    implements EdgeServiceContextModuleBase
{
    private readonly _broadcastToDurableObject: (broadcast: {
        url: `/api/durable-objects/${string}`;
        body: SchemaSerializedValue | null | undefined;
    }) => void;

    private readonly _sendRequestToDurableObject: (
        context: Context<{}>,
        request: {
            url: `/api/durable-objects/${string}`;
            body: SchemaSerializedValue | null | undefined;
        },
    ) => Promise<any>;

    constructor({
        broadcastToDurableObject,
        sendRequestToDurableObject,
    }: {
        broadcastToDurableObject: (broadcast: {
            url: `/api/durable-objects/${string}`;
            body: SchemaSerializedValue | null | undefined;
        }) => void;
        sendRequestToDurableObject: (
            context: Context<{}>,
            request: {
                url: `/api/durable-objects/${string}`;
                body: SchemaSerializedValue | null | undefined;
            },
        ) => Promise<any>;
    }) {
        // Should only be used in tests.
        assert(isTestNodeEnvOrAdminScenariosScript);

        super();

        this._broadcastToDurableObject = broadcastToDurableObject;
        this._sendRequestToDurableObject = sendRequestToDurableObject;
    }

    public async broadcastToDurableObject(
        url: `/api/durable-objects/${string}`,
        {
            body,
        }: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<void> {
        this._broadcastToDurableObject({url, body});
    }

    public async sendRequestToDurableObject(
        url: `/api/durable-objects/${string}`,
        {
            body,
        }: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<any> {
        return this._sendRequestToDurableObject(this._context, {url, body});
    }

    public fork() {
        return new TestLocalEdgeServiceContextModule({
            broadcastToDurableObject: this._broadcastToDurableObject,
            sendRequestToDurableObject: this._sendRequestToDurableObject,
        });
    }
}
