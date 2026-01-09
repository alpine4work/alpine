import {internalSpaceWelcomePackageSearchEntityMaxCount} from "~/server/spaces/internal/dangerously_apply_space_welcome_package.js";

export const spaceWelcomePackageSearchEntityMaxCount =
    // Re-export from a public file so this variable can be used outside
    // `//server/spaces`.
    internalSpaceWelcomePackageSearchEntityMaxCount;
