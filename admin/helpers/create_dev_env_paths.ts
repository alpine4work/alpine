import {DotenvParseOutput} from "dotenv";
import createEnvPaths from "env-paths";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function createDevEnvPaths(env: DotenvParseOutput) {
    const devEnvPathsNameSuffix = assertExists(env.DEV_ENV_PATHS_NAME_SUFFIX);

    if (devEnvPathsNameSuffix !== "" && !/^-[a-z0-9-]*[a-z0-9]$/.test(devEnvPathsNameSuffix)) {
        throw new InternalError("`DEV_ENV_PATHS_NAME_SUFFIX` must be alphanumeric characters only");
    }

    /**
     * Standard paths for development environment data, config, and cache files.
     */
    const devEnvPaths = createEnvPaths(`cyberworlds-development${devEnvPathsNameSuffix}`, {
        suffix: "",
    });

    return devEnvPaths;
}
