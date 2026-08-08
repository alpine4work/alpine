import {createDevEnvPaths} from "~/admin/helpers/create_dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const env = parseDotenv();

export const devEnvPathsNameSuffix = assertExists(env.DEV_ENV_PATHS_NAME_SUFFIX);

/**
 * Standard paths for development environment data, config, and cache files.
 */
export const devEnvPaths = createDevEnvPaths(env);
