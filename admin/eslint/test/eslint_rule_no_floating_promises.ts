import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

async function asyncFunction1() {
    await waitMacrotask();
}

function asyncFunction2() {
    return waitMacrotask();
}

function asyncFunction3(): SafeFloatingPromise<void> {
    return waitMacrotask() as SafeFloatingPromise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function main1() {
    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2();

    // Ok
    asyncFunction3();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction3().then(() => {});

    // Ok
    await asyncFunction1();

    // Ok
    await asyncFunction2();

    // Ok
    await asyncFunction3();

    // Ok
    asyncFunction1().catch(() => {});

    // Ok
    asyncFunction2().catch(() => {});

    // Ok
    asyncFunction3().catch(() => {});

    // Ok
    asyncFunction1().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction2().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction3().then(
        () => {},
        () => {},
    );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function main2() {
    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2();

    // Ok
    asyncFunction3();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction3().then(() => {});

    // Ok
    asyncFunction1().catch(() => {});

    // Ok
    asyncFunction2().catch(() => {});

    // Ok
    asyncFunction3().catch(() => {});

    // Ok
    asyncFunction1().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction2().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction3().then(
        () => {},
        () => {},
    );
}
