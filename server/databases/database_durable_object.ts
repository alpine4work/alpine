import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {NotFoundError} from "~/shared/error/error.js";

type DatabaseDurableObjectRoute = "NotFound";

class DatabaseDurableObject {
    public static readonly serviceName = "DatabaseService";

    private readonly _server: DatabaseServer;

    public static async initialize({
        storage,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
        storage: DurableObjectStorage;
    }): Promise<DatabaseDurableObject> {
        const durableObjectStorage = new DatabaseDurableObjectStorage(storage.sql);
        const server = await DatabaseServer.create(durableObjectStorage);
        return new DatabaseDurableObject(server);
    }

    private constructor(server: DatabaseServer) {
        this._server = server;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static parseRoute(url: URL): [string, DatabaseDurableObjectRoute] {
        return ["/*", "NotFound"];
    }

    public fetch(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        context: WorkerActionContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        request: Request,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        route: DatabaseDurableObjectRoute,
    ): Response {
        throw new NotFoundError("Route not found");
    }
}

const DatabaseDurableObjectWrapper = createDurableObject(DatabaseDurableObject);
export {DatabaseDurableObjectWrapper as DatabaseDurableObject};
