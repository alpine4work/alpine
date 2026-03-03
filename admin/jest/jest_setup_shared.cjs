"use strict";

const {Console} = require("console");
const chalk = require("chalk");

// Use the default Node.js console in Jest instead of Jest's custom console that
// provides debugging information that can get quite noisy.
//
// We have configured eslint to warn on `console.log()` calls which we believe is a
// better method for keeping track of unwanted logs. Generally in our system we
// avoid committing `console.log()`s.
global.console = new Console({
    stdout: process.stdout,
    stderr: process.stderr,
    colorMode: !!chalk.supportsColor,
});

// Globals expected by the `react-refresh` transform applied by SWC.
// `react-refresh` functions noop in tests.
//
// We need this for both client and server tests since some server tests (e.g. ones
// that exercise emailing) need to server render React components.
globalThis.$RefreshReg$ = () => {};
globalThis.$RefreshSig$ = () => value => value;
