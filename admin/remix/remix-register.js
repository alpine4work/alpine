/*!
 * Register the same compiler as Remix (esbuild) to transform TypeScript files
 * (and modern JavaScript files) into code that will execute in the current
 * version of Node.js.
 *
 * You should only use this for one-off scripts! Since this compiles files at
 * runtime, it is not suitable for performance sensitive code.
 */

"use strict";

require("esbuild-register");

// TODO(calebmer): This script may need special support for `.css.ts` files?
