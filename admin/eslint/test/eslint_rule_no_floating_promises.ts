import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {
    SafeFloatingPromise,
    SafeFloatingPromiseLike,
} from "~/shared/helpers/types/safe_floating_promise.js";

async function asyncFunction1() {
    await waitMacrotask();
}

function asyncFunction2() {
    return waitMacrotask();
}

function asyncFunction3(): SafeFloatingPromise<void> {
    return waitMacrotask() as SafeFloatingPromise<void>;
}

function asyncFunction4(): PromiseLike<void> {
    return null as any;
}

function asyncFunction5(): SafeFloatingPromiseLike<void> {
    return null as any;
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
    asyncFunction4();

    // Ok
    asyncFunction5();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction3().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction4().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction5().then(() => {});

    // Ok
    await asyncFunction1();

    // Ok
    await asyncFunction2();

    // Ok
    await asyncFunction3();

    // Ok
    await asyncFunction4();

    // Ok
    await asyncFunction5();

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

    // Ok
    asyncFunction4().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction5().then(
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
    asyncFunction4();

    // Ok
    asyncFunction5();

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction1().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction2().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction3().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction4().then(() => {});

    // Error
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    asyncFunction5().then(() => {});

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

    // Ok
    asyncFunction4().then(
        () => {},
        () => {},
    );

    // Ok
    asyncFunction5().then(
        () => {},
        () => {},
    );
}
