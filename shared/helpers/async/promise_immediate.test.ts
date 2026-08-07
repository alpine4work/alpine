import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";

async function wait(ms: number = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

test("will reject a promise that throws in the executor", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>(() => {
        throw error;
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error});
});

test("will resolve a promise synchronously that resolves immediately", () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(42);
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: true, value: 42});
});

test("will reject a promise synchronously that rejects immediately", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error);
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error});
});

test("will resolve a promise synchronously that resolves with a resolved immediate promise", () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(
            new PromiseImmediate<number>(resolve => {
                resolve(42);
            }),
        );
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: true, value: 42});
});

test("will reject a promise synchronously that resolves with a rejected immediate promise", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(
            new PromiseImmediate<number>((resolve, reject) => {
                reject(error);
            }),
        );
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error});
});

test("will reject a promise synchronously that rejects with a resolved immediate promise", () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(
            new PromiseImmediate<number>(resolve => {
                resolve(42);
            }),
        );
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error: 42});
});

test("will reject a promise synchronously that rejects with a rejected immediate promise", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(
            new PromiseImmediate<number>((resolve, reject) => {
                reject(error);
            }),
        );
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error});
});

test("will resolve a promise that resolves asynchronously", async () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        void wait().then(() => {
            resolve(42);
        });
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: true, value: 42});
});

test("will reject a promise synchronously that rejects asynchronously", async () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        void wait().then(() => {
            reject(error);
        });
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: false, error});
});

test("will ignore calls to resolve and reject after the first resolve", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        resolve(1);
        resolve(2);
        reject(error);
        resolve(3);
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: true, value: 1});
});

test("will ignore calls to resolve and reject after the first reject", () => {
    let result: Result<number, unknown> | null = null;
    const error1 = new InternalError("test1");
    const error2 = new InternalError("test2");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error1);
        resolve(1);
        resolve(2);
        reject(error2);
        resolve(3);
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error: error1});
});

test("will ignore thrown errors after the first resolve", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(1);
        throw error;
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: true, value: 1});
});

test("will ignore thrown errors after the first reject", () => {
    let result: Result<number, unknown> | null = null;
    const error1 = new InternalError("test1");
    const error2 = new InternalError("test2");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error1);
        throw error2;
    });

    expect(result).toEqual(null);

    void promise.then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error: error1});
});

test("will resolve a chained no callback promise synchronously that resolves immediately", () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(42);
    });

    expect(result).toEqual(null);

    void promise.then().then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: true, value: 42});
});

test("will reject a chained no callback promise synchronously that rejects immediately", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error);
    });

    expect(result).toEqual(null);

    void promise.then().then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual({ok: false, error});
});

test("will reject a resolved chained promise that throws in the callback", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(42);
    });

    expect(result).toEqual(null);

    void promise
        .then(value => {
            expect(value).toEqual(42);
            throw error;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual({ok: false, error});
});

test("will reject a rejected chained promise with a new InternalError that throws in the callback", () => {
    let result: Result<number, unknown> | null = null;
    const error1 = new InternalError("test1");
    const error2 = new InternalError("test2");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error1);
    });

    expect(result).toEqual(null);

    void promise
        .then(null, error => {
            expect(error).toEqual(error1);
            throw error2;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual({ok: false, error: error2});
});

test("will resolve a resolved chained promise with a new value from the callback", () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        resolve(1);
    });

    expect(result).toEqual(null);

    void promise
        .then(value => {
            expect(value).toEqual(1);
            return 2;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual({ok: true, value: 2});
});

test("will resolve a rejected chained promise with a new value from the callback", () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test1");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        reject(error);
    });

    expect(result).toEqual(null);

    void promise
        .then(null, error => {
            expect(error).toEqual(error);
            return 42;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual({ok: true, value: 42});
});

test("will resolve a chained no callback promise asynchronously that resolves", async () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        void wait().then(() => {
            resolve(42);
        });
    });

    expect(result).toEqual(null);

    void promise.then().then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: true, value: 42});
});

test("will reject a chained no callback promise asynchronously that rejects", async () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        void wait().then(() => {
            reject(error);
        });
    });

    expect(result).toEqual(null);

    void promise.then().then(
        value => {
            expect(result).toEqual(null);
            result = {ok: true, value};
        },
        error => {
            expect(result).toEqual(null);
            result = {ok: false, error};
        },
    );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: false, error});
});

test("will reject a resolved chained promise that throws in the callback asynchronously", async () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test");

    const promise = new PromiseImmediate<number>(resolve => {
        void wait().then(() => {
            resolve(42);
        });
    });

    expect(result).toEqual(null);

    void promise
        .then(value => {
            expect(value).toEqual(42);
            throw error;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: false, error});
});

test("will reject a rejected chained promise with a new InternalError that throws in the callback asynchronously", async () => {
    let result: Result<number, unknown> | null = null;
    const error1 = new InternalError("test1");
    const error2 = new InternalError("test2");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        void wait().then(() => {
            reject(error1);
        });
    });

    expect(result).toEqual(null);

    void promise
        .then(null, error => {
            expect(error).toEqual(error1);
            throw error2;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: false, error: error2});
});

test("will resolve a resolved chained promise with a new value from the callback asynchronously", async () => {
    let result: Result<number, unknown> | null = null;

    const promise = new PromiseImmediate<number>(resolve => {
        void wait().then(() => {
            resolve(1);
        });
    });

    expect(result).toEqual(null);

    void promise
        .then(value => {
            expect(value).toEqual(1);
            return 2;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: true, value: 2});
});

test("will resolve a rejected chained promise with a new value from the callback asynchronously", async () => {
    let result: Result<number, unknown> | null = null;
    const error = new InternalError("test1");

    const promise = new PromiseImmediate<number>((resolve, reject) => {
        void wait().then(() => {
            reject(error);
        });
    });

    expect(result).toEqual(null);

    void promise
        .then(null, error => {
            expect(error).toEqual(error);
            return 42;
        })
        .then(
            value => {
                expect(result).toEqual(null);
                result = {ok: true, value};
            },
            error => {
                expect(result).toEqual(null);
                result = {ok: false, error};
            },
        );

    expect(result).toEqual(null);
    await wait();
    expect(result).toEqual({ok: true, value: 42});
});

test("all settled with no values resolves immediately", async () => {
    expect(PromiseImmediate.allSettled([]).getStateWithoutListening()).toEqual({
        status: "fulfilled",
        value: [],
    });
});

test("all settled with non-promise values resolves immediately", async () => {
    expect(PromiseImmediate.allSettled([1, 2, 3]).getStateWithoutListening()).toEqual({
        status: "fulfilled",
        value: [
            {status: "fulfilled", value: 1},
            {status: "fulfilled", value: 2},
            {status: "fulfilled", value: 3},
        ],
    });
});

test("all settled with immediately resolving promises resolves immediately", async () => {
    expect(
        PromiseImmediate.allSettled([
            PromiseImmediate.resolve(1),
            PromiseImmediate.reject(2),
            PromiseImmediate.resolve(3),
            4,
            5,
        ]).getStateWithoutListening(),
    ).toEqual({
        status: "fulfilled",
        value: [
            {status: "fulfilled", value: 1},
            {status: "rejected", reason: 2},
            {status: "fulfilled", value: 3},
            {status: "fulfilled", value: 4},
            {status: "fulfilled", value: 5},
        ],
    });
});

test("all settled will only resolve once all promises have resolved", async () => {
    const promiseResolver1 = createPromiseResolver<number>();
    const promiseResolver2 = createPromiseResolver<number>();
    const promiseResolver3 = createPromiseResolver<number>();

    const promise = PromiseImmediate.allSettled([
        PromiseImmediate.resolve(1),
        PromiseImmediate.reject(2),
        3,
        promiseResolver1.promise,
        promiseResolver2.promise,
        promiseResolver3.promise,
    ]);

    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});

    promiseResolver1.resolve(4);

    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});
    await waitMacrotask();
    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});

    promiseResolver2.reject(5);

    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});
    await waitMacrotask();
    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});

    promiseResolver3.resolve(6);

    expect(promise.getStateWithoutListening()).toEqual({status: "pending"});
    await waitMacrotask();
    expect(promise.getStateWithoutListening()).toEqual({
        status: "fulfilled",
        value: [
            {status: "fulfilled", value: 1},
            {status: "rejected", reason: 2},
            {status: "fulfilled", value: 3},
            {status: "fulfilled", value: 4},
            {status: "rejected", reason: 5},
            {status: "fulfilled", value: 6},
        ],
    });
});
