import createEnvPaths from "env-paths";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const env = parseDotenv();

export const devEnvPathsNameSuffix = assertExists(env.DEV_ENV_PATHS_NAME_SUFFIX);

if (devEnvPathsNameSuffix !== "" && !/^-[a-z0-9-]*[a-z0-9]$/.test(devEnvPathsNameSuffix)) {
    throw new InternalError("`DEV_ENV_PATHS_NAME_SUFFIX` must be alphanumeric characters only");
}

/**
 * Standard paths for development environment data, config, and cache files.
 */
export const devEnvPaths = createEnvPaths(`cyberworlds-development${devEnvPathsNameSuffix}`, {
    suffix: "",
});
