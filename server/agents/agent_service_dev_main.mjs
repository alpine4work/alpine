import fs from "fs-extra";
import inspector from "inspector";
import {Miniflare} from "miniflare";
import {join as joinPath} from "path";
import toml from "toml";
import {parseArgs} from "util";
import {
    runDevAgentsD1ApplyCommand,
    runDevAgentsD1StatusCommand,
    // eslint-disable-next-line cyberworlds/sort-imports-by-source
} from "../../admin/dev/agents_d1/dev_agents_d1_commands.js";

// Make our service easy to find in process managers. We include
// "cyberworlds" and "node" so you can grep by those strings.
process.title = "AgentServiceFamily dev (cyberworlds, node)";

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    // eslint-disable-next-line no-console
    console.error(error);
});

async function main() {
    const {
        values: {
            port: portString,
            cacheLocalDataPath,
            durableObjectsLocalDataPath,
            d1LocalDataPath,
            apiServiceUrl,
            edgeServiceUrl,
            chatGptApiServiceKey: chatGptApiServiceKeyPath,
            cursorApiServiceKey: cursorApiServiceKeyPath,
            mockChatGptApiServiceKey: mockChatGptApiServiceKeyPath,
            honeycombApiKey,
            openAiDevApiKey,
            cursorAgentSmeeWebhookUrl,
            withoutD1Migrations,
            inspectorPort: inspectorPortString,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            cacheLocalDataPath: {type: "string"},
            durableObjectsLocalDataPath: {type: "string"},
            d1LocalDataPath: {type: "string"},
            apiServiceUrl: {type: "string"},
            edgeServiceUrl: {type: "string"},
            chatGptApiServiceKey: {type: "string"},
            cursorApiServiceKey: {type: "string"},
            mockChatGptApiServiceKey: {type: "string"},
            honeycombApiKey: {type: "string"},
            openAiDevApiKey: {type: "string"},
            cursorAgentSmeeWebhookUrl: {type: "string"},
            withoutD1Migrations: {type: "boolean"},
            inspectorPort: {type: "string"},
        },
    });

    if (inspectorPortString) {
        inspector.open(parseInt(inspectorPortString, 10));
    }

    if (!cacheLocalDataPath) throw new Error("Missing `cacheLocalDataPath` option");
    if (!durableObjectsLocalDataPath)
        throw new Error("Missing `durableObjectsLocalDataPath` option");
    if (!d1LocalDataPath) throw new Error("Missing `d1LocalDataPath` option");
    if (!apiServiceUrl) throw new Error("Missing `apiServiceUrl` option");
    if (!mockChatGptApiServiceKeyPath) throw new Error("Missing `mockChatGptApiServiceKey` option");

    const chatGptApiServiceKey = chatGptApiServiceKeyPath
        ? (await fs.readFile(chatGptApiServiceKeyPath, "utf8")).trim()
        : undefined;
    const cursorApiServiceKey = cursorApiServiceKeyPath
        ? (await fs.readFile(cursorApiServiceKeyPath, "utf8")).trim()
        : undefined;
    const mockChatGptApiServiceKey = (
        await fs.readFile(mockChatGptApiServiceKeyPath, "utf8")
    ).trim();

    if (!portString) throw new Error("Missing `port` option");
    const port = parseInt(portString, 10);

    const runfilesPath = process.env.RUNFILES;
    if (!runfilesPath) throw new Error("Missing runfiles env variable");

    const configString = fs.readFileSync(
        joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.toml"),
    );
    const config = toml.parse(configString);

    // Integration tests turn off D1 migrations.
    if (!withoutD1Migrations) {
        if ((await runDevAgentsD1StatusCommand({quiet: true})) === "CommittedMigrations") {
            // eslint-disable-next-line no-console
            console.log("D1 migrations required, applying...");

            await runDevAgentsD1ApplyCommand();
        }
    }

    const miniflare = new Miniflare({
        name: config.name,
        modules: [
            {
                type: "ESModule",
                path: joinPath(runfilesPath, "cyberworlds/server/agents/agent_service_bundle.js"),
            },
        ],
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        port,
        cachePersist: cacheLocalDataPath,
        durableObjectsPersist: durableObjectsLocalDataPath,
        d1Persist: d1LocalDataPath,
        bindings: filterUndefined({
            API_SERVICE_URL: apiServiceUrl,
            EDGE_SERVICE_URL: edgeServiceUrl,
            CHAT_GPT_API_SERVICE_KEY: chatGptApiServiceKey,
            CURSOR_API_SERVICE_KEY: cursorApiServiceKey,
            MOCK_CHAT_GPT_API_SERVICE_KEY: mockChatGptApiServiceKey,
            OPEN_AI_API_KEY: openAiDevApiKey,
            HONEYCOMB_API_KEY: honeycombApiKey,
            CURSOR_AGENT_SMEE_WEBHOOK_URL: cursorAgentSmeeWebhookUrl,
        }),
        durableObjects: buildDurableObjects(config),
        d1Databases: buildD1Databases(config),
    });

    await miniflare.ready;
}

// Miniflare v4 validates that all binding values are defined. Filter out
// undefined values for optional bindings (e.g. HONEYCOMB_API_KEY).
function filterUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function buildDurableObjects(config) {
    const sqliteClasses = new Set();
    for (const migration of config.migrations ?? []) {
        for (const cls of migration.new_sqlite_classes ?? []) {
            sqliteClasses.add(cls);
        }
    }
    const result = {};
    for (const binding of config.durable_objects?.bindings ?? []) {
        result[binding.name] = {
            className: binding.class_name,
            ...(sqliteClasses.has(binding.class_name) && {useSQLite: true}),
        };
    }
    return result;
}

function buildD1Databases(config) {
    const result = {};
    for (const db of config.d1_databases ?? []) {
        result[db.binding] = db.database_id;
    }
    return result;
}
