import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";

const env = parseDotenv();

export function createAdhocTracer() {
    return createServerTracer({
        serviceName: "Admin",
        jsHost: "Node",
        // TODO(calebmer): If we are running an adhoc script against our production
        // database then events should go to our production Honeycomb environment?
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "tracer",
        // Node.js automatically waits for all promises to finish before exiting
        // the process.
        waitUntil: promise => {
            promise.catch(error => {
                // eslint-disable-next-line no-console
                console.error(error);
            });
        },
    });
}
