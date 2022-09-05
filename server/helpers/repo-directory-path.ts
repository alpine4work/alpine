import path from "path";

const isNextJS = __dirname === "/";

/**
 * The absolute file system path to the directory our Cyberworlds repository
 * lives in no matter what environment we’re executing in.
 *
 * Next.js sets `__dirname` to `/` since code is cross compiled and placed in
 * a sub-directory. So [when executing in Next.js][1] we need to use
 * `process.cwd()`. When executing outside of Next.js using `__dirname` gives us
 * a more stable path.
 *
 * [1]: https://nextjs.org/docs/basic-features/data-fetching#reading-files-use-processcwd
 */
export const repoDirectoryPath = isNextJS ? process.cwd() : path.resolve(__dirname, "../..");
