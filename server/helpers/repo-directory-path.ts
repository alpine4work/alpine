import path from "path";

const isNextJs = __dirname.includes("/.next/");

/**
 * The absolute file system path to the directory our Cyberworlds repository
 * lives in no matter what environment we’re executing in.
 *
 * Next.js sets `__dirname` to a build directory since code is cross compiled
 * and placed in a sub-directory. So [when executing in Next.js][1] we need to
 * use `process.cwd()`. When executing outside of Next.js using `__dirname`
 * gives us a more stable path.
 *
 * [1]: https://nextjs.org/docs/api-reference/data-fetching/get-static-props#reading-files-use-processcwd
 */
export const repoDirectoryPath = isNextJs ? process.cwd() : path.resolve(__dirname, "../..");
