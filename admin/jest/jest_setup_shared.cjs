"use strict";

const {Console} = require("console");
const chalk = require("chalk");

// Use the default Node.js console in Jest instead of Jest's custom console
// that provides debugging information that can get quite noisy.
//
// We have configured eslint to warn on `console.log()` calls which we believe
// is a better method for keeping track of unwanted logs. Generally in our
// system we avoid committing `console.log()`s.
global.console = new Console({
    stdout: process.stdout,
    stderr: process.stderr,
    colorMode: !!chalk.supportsColor,
});
