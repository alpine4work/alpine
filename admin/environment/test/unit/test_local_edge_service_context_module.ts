import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * An implementation of `EdgeServiceContextModuleBase` for tests that records
 * edge service calls so tests can inspect them.
 */
export class TestLocalEdgeServiceContextModule
    extends ContextModuleBase
    implements EdgeServiceContextModuleBase
{
    private readonly _pushDurableObjectBroadcast: (broadcast: {
        url: `/api/durable-objects/${string}`;
        body: SchemaSerializedValue | null | undefined;
    }) => void;

    constructor({
        pushDurableObjectBroadcast,
    }: {
        pushDurableObjectBroadcast: (broadcast: {
            url: `/api/durable-objects/${string}`;
            body: SchemaSerializedValue | null | undefined;
        }) => void;
    }) {
        // Should only be used in tests.
        assert(isTestNodeEnvOrAdminScenariosScript);

        super();

        this._pushDurableObjectBroadcast = pushDurableObjectBroadcast;
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
        this._pushDurableObjectBroadcast({url, body});
    }

    public fork() {
        return new TestLocalEdgeServiceContextModule({
            pushDurableObjectBroadcast: this._pushDurableObjectBroadcast,
        });
    }
}
