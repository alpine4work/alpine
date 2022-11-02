import path from "path";

/**
 * The absolute file system path to the directory our Cyberworlds repository
 * lives in no matter what environment we’re executing in.
 */
export const repoDirectoryPath = path.resolve(__dirname, "../..");
