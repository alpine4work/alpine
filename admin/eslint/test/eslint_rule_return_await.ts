import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";

async function asyncFunction1() {
    await waitMacrotask();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function asyncFunction2() {
    // Error
    // eslint-disable-next-line @typescript-eslint/return-await
    return waitMacrotask();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function asyncFunction3() {
    // Error
    // eslint-disable-next-line @typescript-eslint/return-await
    return asyncFunction1();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function asyncFunction4() {
    return await waitMacrotask();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function asyncFunction5() {
    return await asyncFunction1();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function asyncFunction6() {
    return 1;
}
