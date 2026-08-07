import {expectTypeOf} from "expect-type";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";

class TestContextModule extends ContextModuleBase {
    public readonly id = Symbol();

    public clone<Modules extends {}>(
        this: ContextModuleBase<Modules> & TestContextModule,
    ): ContextWithDestroy<Replace<Modules, {test2: TestContextModule}>> {
        return this._context.clone({
            test2: new TestContextModule(),
        });
    }
}

class DependentTestContextModule extends ContextModuleBase<{test1: TestContextModule}> {
    public readonly id = Symbol();

    public test1() {
        return this._context.test1;
    }
}

test("create context with modules", () => {
    const testModule1 = new TestContextModule();
    const testModule2 = new TestContextModule();

    const context = Context.new({
        test1: testModule1,
        test2: testModule2,
    });

    expect(context.test1.id).toEqual(testModule1.id);
    expect(context.test2.id).toEqual(testModule2.id);
});

test("destroy prevents module from being accessed again", () => {
    const testModule1 = new TestContextModule();
    const testModule2 = new TestContextModule();

    const context = Context.new({
        test1: testModule1,
        test2: testModule2,
    });

    expect(context.test1.id).toEqual(testModule1.id);
    expect(context.test2.id).toEqual(testModule2.id);

    context.destroy();

    expect(() => context.test1.id).toThrow(InternalError);
    expect(() => context.test2.id).toThrow(InternalError);
});

test("context modules can reference each other", () => {
    const testModule1 = new TestContextModule();
    const testModule2 = new DependentTestContextModule();

    const context = Context.new({
        test1: testModule1,
        test2: testModule2,
    });

    expect(context.test1.id).toEqual(testModule1.id);
    expect(context.test2.id).toEqual(testModule2.id);
    expect(context.test2.test1().id).toEqual(testModule1.id);
});

test("context module that references each other must have dependency modules of the right type", async () => {
    class BadTestContextModule extends ContextModuleBase {}

    Context.new(
        // @ts-expect-error: Missing `test1` property.
        {
            test2: new DependentTestContextModule(),
        },
    );

    Context.new({
        // @ts-expect-error: Incorrect `test1` property.
        test1: new BadTestContextModule(),
        test2: new DependentTestContextModule(),
    });

    await Context.with(
        // @ts-expect-error: Missing `test1` property.
        {
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );

    await Context.with(
        {
            // @ts-expect-error: Incorrect `test1` property.
            test1: new BadTestContextModule(),
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );
});

test("context module that references each other must have dependency modules of the right type when cloning too", async () => {
    class BadTestContextModule extends ContextModuleBase {
        public readonly bad = true;
    }

    const context1 = Context.new({});
    const context2 = Context.new({test1: new BadTestContextModule()});
    const context3 = Context.new({test1: new TestContextModule()});

    // TODO(calebmer): Would ideally create some kind of TypeScript error. Struggling
    // to find a good way to do that.
    context1.clone({
        test2: new DependentTestContextModule(),
    });

    // Would ideally create some kind of TypeScript error. Struggling to find a good
    // way to do that.
    context2.clone({
        test2: new DependentTestContextModule(),
    });

    context3.clone({
        test2: new DependentTestContextModule(),
    });

    // Would ideally create some kind of TypeScript error. Struggling to find a good
    // way to do that.
    context1.clone({
        test1: new BadTestContextModule(),
        test2: new DependentTestContextModule(),
    });

    context1.clone({
        test1: new TestContextModule(),
        test2: new DependentTestContextModule(),
    });

    // Would ideally create some kind of TypeScript error. Struggling to find a good
    // way to do that.
    await context1.with(
        {
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );

    // Would ideally create some kind of TypeScript error. Struggling to find a good
    // way to do that.
    await context2.with(
        {
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );

    await context3.with(
        {
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );

    // Would ideally create some kind of TypeScript error. Struggling to find a good
    // way to do that.
    await context1.with(
        {
            test1: new BadTestContextModule(),
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );

    await context1.with(
        {
            test1: new TestContextModule(),
            test2: new DependentTestContextModule(),
        },
        async () => {},
    );
});

test("context modules can create a context clone", () => {
    const context = Context.new({
        test1: new TestContextModule(),
    });

    expect("test1" in context).toEqual(true);
    expect("test2" in context).toEqual(false);

    const clonedContext = context.test1.clone();

    expect("test1" in context).toEqual(true);
    expect("test2" in context).toEqual(false);
    expect("test1" in clonedContext).toEqual(true);
    expect("test2" in clonedContext).toEqual(true);
    expect(clonedContext.test1.id).toEqual(context.test1.id);
    expect(clonedContext.test2.id).not.toEqual(clonedContext.test1.id);
});

test("can destroy a cloned context", () => {
    const context = Context.new({
        test1: new TestContextModule(),
    });

    const clonedContext = context.test1.clone();

    expect(() => context.test1.id).not.toThrow(InternalError);
    expect(() => clonedContext.test1.id).not.toThrow(InternalError);
    expect(() => clonedContext.test2.id).not.toThrow(InternalError);

    clonedContext.destroy();

    expect(() => context.test1.id).not.toThrow(InternalError);
    expect(() => clonedContext.test1.id).toThrow(InternalError);
    expect(() => clonedContext.test2.id).toThrow(InternalError);

    context.destroy();

    expect(() => context.test1.id).toThrow(InternalError);
    expect(() => clonedContext.test1.id).toThrow(InternalError);
    expect(() => clonedContext.test2.id).toThrow(InternalError);
});

test("destroying a parent context also destroys the child context", () => {
    const context = Context.new({
        test1: new TestContextModule(),
    });

    const clonedContext = context.test1.clone();

    expect(() => context.test1.id).not.toThrow(InternalError);
    expect(() => clonedContext.test1.id).not.toThrow(InternalError);
    expect(() => clonedContext.test2.id).not.toThrow(InternalError);

    context.destroy();

    expect(() => context.test1.id).toThrow(InternalError);
    expect(() => clonedContext.test1.id).toThrow(InternalError);
    expect(() => clonedContext.test2.id).toThrow(InternalError);
});

test("updates in a different context module stay when cloning from another context module", () => {
    class Counter1ContextModule extends ContextModuleBase {
        constructor(public readonly count: number) {
            super();
        }

        public increment<Modules extends {}>(
            this: ContextModuleBase<Modules> & Counter1ContextModule,
        ) {
            return this._context.clone({
                counter1: new Counter1ContextModule(this.count + 1),
            });
        }
    }

    class Counter2ContextModule extends ContextModuleBase {
        constructor(public readonly count: number) {
            super();
        }

        public increment<Modules extends {}>(
            this: ContextModuleBase<Modules> & Counter2ContextModule,
        ) {
            return this._context.clone({
                counter2: new Counter2ContextModule(this.count + 1),
            });
        }
    }

    let context = Context.new({
        counter1: new Counter1ContextModule(0),
        counter2: new Counter2ContextModule(0),
    });

    expect(context.counter1.count).toEqual(0);
    expect(context.counter2.count).toEqual(0);

    context = context.counter1.increment();

    expect(context.counter1.count).toEqual(1);
    expect(context.counter2.count).toEqual(0);

    context = context.counter1.increment();
    context = context.counter1.increment();

    expect(context.counter1.count).toEqual(3);
    expect(context.counter2.count).toEqual(0);

    context = context.counter2.increment();

    expect(context.counter1.count).toEqual(3);
    expect(context.counter2.count).toEqual(1);
});

test("can not assign to own property in context module", () => {
    class TestContextModule extends ContextModuleBase {
        public counter1 = 0;
        public readonly counter2 = {current: 0};

        public increment1() {
            this.counter1++;
        }

        public increment2() {
            this.counter2.current++;
        }
    }

    const context = Context.new({
        test: new TestContextModule(),
    });

    expect(context.test.counter1).toEqual(0);
    expect(context.test.counter2.current).toEqual(0);

    expect(() => context.test.increment1()).toThrow(
        new TypeError("Cannot add property counter1, object is not extensible"),
    );
    expect(() => context.test.increment2()).not.toThrow();

    expect(context.test.counter1).toEqual(0);
    expect(context.test.counter2.current).toEqual(1);

    const clonedContext = context.clone({});

    expect(context.test.counter1).toEqual(0);
    expect(context.test.counter2.current).toEqual(1);
    expect(clonedContext.test.counter1).toEqual(0);
    expect(clonedContext.test.counter2.current).toEqual(1);

    expect(() => context.test.increment1()).toThrow(
        new TypeError("Cannot add property counter1, object is not extensible"),
    );
    expect(() => context.test.increment2()).not.toThrow();

    expect(context.test.counter1).toEqual(0);
    expect(context.test.counter2.current).toEqual(2);
    expect(clonedContext.test.counter1).toEqual(0);
    expect(clonedContext.test.counter2.current).toEqual(2);
});

test("can clone into subclass but not superclass", () => {
    class SuperClassTestContextModule extends ContextModuleBase {
        public intoSubClass<Modules extends {}>(
            this: ContextModuleBase<Modules> & SuperClassTestContextModule,
        ) {
            return this._context.clone({
                test: new SubClassTestContextModule(),
            });
        }
    }

    class SubClassTestContextModule extends SuperClassTestContextModule {
        public intoSuperClass<Modules extends {}>(
            this: ContextModuleBase<Modules> & SubClassTestContextModule,
        ) {
            return this._context.clone({
                test: new SuperClassTestContextModule(),
            });
        }
    }

    class OtherTestContextModule extends ContextModuleBase {
        public get<Modules extends {}>(
            this: ContextModuleBase<Modules> & OtherTestContextModule,
        ): Context<Modules> {
            return this._context;
        }
    }

    const context1 = Context.new({
        test: new SuperClassTestContextModule(),
        otherTest: new OtherTestContextModule(),
    });

    const context2 = context1.test.intoSubClass();
    context2.test.intoSubClass();

    expect(() => context2.test.intoSuperClass()).toThrow(
        new InternalError(
            "Assertion failure: If replacing a context module, the new context module should be a subclass of the old context module",
        ),
    );
});

test("can clone into subclass and the type for other contexts will reflect that", () => {
    class SuperClassTestContextModule extends ContextModuleBase {
        public intoSubClass<Modules extends {}>(
            this: ContextModuleBase<Modules> & SuperClassTestContextModule,
        ) {
            return this._context.clone({
                test: new SubClassTestContextModule(),
            });
        }
    }

    class SubClassTestContextModule extends SuperClassTestContextModule {
        public intoSuperClass<Modules extends {}>(
            this: ContextModuleBase<Modules> & SubClassTestContextModule,
        ) {
            return this._context.clone({
                test: new SuperClassTestContextModule(),
            });
        }
    }

    class OtherTestContextModule extends ContextModuleBase {
        public get<Modules extends {}>(
            this: ContextModuleBase<Modules> & OtherTestContextModule,
        ): Context<Modules> {
            return this._context;
        }
    }

    const context1 = Context.new({
        test: new SuperClassTestContextModule(),
        otherTest: new OtherTestContextModule(),
    });

    const context2 = context1.test.intoSubClass();

    expectTypeOf(context1.otherTest.get()).toMatchTypeOf<{
        test: SuperClassTestContextModule;
        otherTest: OtherTestContextModule;
    }>();

    expectTypeOf(context1.otherTest.get()).not.toMatchTypeOf<{
        test: SubClassTestContextModule;
        otherTest: OtherTestContextModule;
    }>();

    expectTypeOf(context2.otherTest.get()).toMatchTypeOf<{
        test: SuperClassTestContextModule;
        otherTest: OtherTestContextModule;
    }>();

    expectTypeOf(context2.otherTest.get()).toMatchTypeOf<{
        test: SubClassTestContextModule;
        otherTest: OtherTestContextModule;
    }>();
});

test("can\u2019t construct a context with a module that\u2019s already been bound", () => {
    const contextModule = new TestContextModule();

    const context1 = Context.new({
        test: contextModule,
    });

    expect(() => {
        Context.new({
            test: context1.test,
        });
    }).toThrow();

    Context.new({
        test: contextModule,
    });
});

test("race condition: context is destroyed correctly when `waitUntil()` adds a promise after child context\u2019s action finishes but before parent context\u2019s action finishes", async () => {
    const promiseWaiter = new PromiseWaiter();

    const promiseResolver1 = createPromiseResolver();
    const promiseResolver3 = createPromiseResolver();
    const promiseResolver2 = createPromiseResolver();

    const rootContext = Context.new({
        process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil}),
    });

    let parentContext: Context<{process: ProcessContextModule}>;

    await rootContext.with({}, async _parentContext => {
        parentContext = _parentContext;

        await parentContext.with({}, async childContext => {
            childContext.process.waitUntil(async () => {
                await promiseResolver1.promise;
                childContext.process.waitUntil(promiseResolver3.promise);
            });

            childContext.process.waitUntil(promiseResolver2.promise);
        });

        promiseResolver1.resolve();
        await waitMacrotask();
    });

    promiseResolver2.resolve();
    await waitMacrotask();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).not.toThrow("Context was destroyed");

    promiseResolver3.resolve();
    await waitMacrotask();

    await promiseWaiter.wait();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).toThrow("Context was destroyed");
});

test("race condition: context is destroyed correctly when `waitUntil()` adds a promise after child context\u2019s action finishes but before parent context\u2019s action finishes (variant: `withSync()`)", async () => {
    const promiseWaiter = new PromiseWaiter();

    const promiseResolver1 = createPromiseResolver();
    const promiseResolver3 = createPromiseResolver();
    const promiseResolver2 = createPromiseResolver();

    const rootContext = Context.new({
        process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil}),
    });

    let parentContext: Context<{process: ProcessContextModule}>;

    await rootContext.with({}, async _parentContext => {
        parentContext = _parentContext;

        parentContext.withSync({}, childContext => {
            childContext.process.waitUntil(async () => {
                await promiseResolver1.promise;
                childContext.process.waitUntil(promiseResolver3.promise);
            });

            childContext.process.waitUntil(promiseResolver2.promise);
        });

        promiseResolver1.resolve();
        await waitMacrotask();
    });

    promiseResolver2.resolve();
    await waitMacrotask();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).not.toThrow("Context was destroyed");

    promiseResolver3.resolve();
    await waitMacrotask();

    await promiseWaiter.wait();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).toThrow("Context was destroyed");
});

test("race condition: context is destroyed correctly when `waitUntil()` adds a promise after child context\u2019s action finishes but before parent context\u2019s action finishes (variant: `Context.with()`)", async () => {
    const promiseWaiter = new PromiseWaiter();

    const promiseResolver1 = createPromiseResolver();
    const promiseResolver3 = createPromiseResolver();
    const promiseResolver2 = createPromiseResolver();

    let parentContext: Context<{process: ProcessContextModule}>;

    await Context.with(
        {process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil})},
        async _parentContext => {
            parentContext = _parentContext;

            await parentContext.with({}, async childContext => {
                childContext.process.waitUntil(async () => {
                    await promiseResolver1.promise;
                    childContext.process.waitUntil(promiseResolver3.promise);
                });

                childContext.process.waitUntil(promiseResolver2.promise);
            });

            promiseResolver1.resolve();
            await waitMacrotask();
        },
    );

    promiseResolver2.resolve();
    await waitMacrotask();

    expect(() => parentContext.process).not.toThrow("Context was destroyed");

    promiseResolver3.resolve();
    await waitMacrotask();

    await promiseWaiter.wait();

    expect(() => parentContext.process).toThrow("Context was destroyed");
});

test("race condition: context is destroyed correctly when `waitUntil()` adds a promise after child context\u2019s action finishes but before parent context\u2019s action finishes (variant: intermediate non-action scoped context)", async () => {
    const promiseWaiter = new PromiseWaiter();

    const promiseResolver1 = createPromiseResolver();
    const promiseResolver3 = createPromiseResolver();
    const promiseResolver2 = createPromiseResolver();

    const rootContext = Context.new({
        process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil}),
    });

    let parentContext: Context<{process: ProcessContextModule}>;
    let intermediateContext: Context<{process: ProcessContextModule}>;

    await rootContext.with({}, async _parentContext => {
        parentContext = _parentContext;

        intermediateContext = parentContext.clone({});

        await intermediateContext.with({}, async childContext => {
            childContext.process.waitUntil(async () => {
                await promiseResolver1.promise;
                childContext.process.waitUntil(promiseResolver3.promise);
            });

            childContext.process.waitUntil(promiseResolver2.promise);
        });

        promiseResolver1.resolve();
        await waitMacrotask();
    });

    promiseResolver2.resolve();
    await waitMacrotask();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).not.toThrow("Context was destroyed");
    expect(() => intermediateContext.process).not.toThrow("Context was destroyed");

    promiseResolver3.resolve();
    await waitMacrotask();

    await promiseWaiter.wait();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).toThrow("Context was destroyed");
    expect(() => intermediateContext.process).toThrow("Context was destroyed");
});

test("race condition: context is destroyed correctly when `waitUntil()` adds a promise after child context\u2019s action finishes but before parent context\u2019s action finishes (variant: fully resolve inside action)", async () => {
    const promiseWaiter = new PromiseWaiter();

    const promiseResolver1 = createPromiseResolver();
    const promiseResolver3 = createPromiseResolver();
    const promiseResolver2 = createPromiseResolver();

    const rootContext = Context.new({
        process: new ProcessContextModule({waitUntil: promiseWaiter.waitUntil}),
    });

    let parentContext: Context<{process: ProcessContextModule}>;

    await rootContext.with({}, async _parentContext => {
        parentContext = _parentContext;

        await parentContext.with({}, async childContext => {
            childContext.process.waitUntil(async () => {
                await promiseResolver1.promise;
                childContext.process.waitUntil(promiseResolver3.promise);
            });

            childContext.process.waitUntil(promiseResolver2.promise);
        });

        promiseResolver1.resolve();
        await waitMacrotask();

        promiseResolver2.resolve();
        await waitMacrotask();

        promiseResolver3.resolve();
        await waitMacrotask();

        expect(() => rootContext.process).not.toThrow("Context was destroyed");
        expect(() => parentContext.process).not.toThrow("Context was destroyed");
    });

    await promiseWaiter.wait();

    expect(() => rootContext.process).not.toThrow("Context was destroyed");
    expect(() => parentContext.process).toThrow("Context was destroyed");
});

describe("bound context modules", () => {
    const testContextModule = new TestContextModule();
    const context1 = Context.new({test: testContextModule});
    const context2 = context1.clone({});
    const context3 = context2.clone({});

    test("when creating a context the bound context module has an own `_context` property", () => {
        expect(hasOwnProperty(testContextModule, "_context")).toEqual(false);
        expect(hasOwnProperty(context1.test, "_context")).toEqual(true);
        expect((context1.test as any)._context).toBe(context1);
    });

    test("when cloning a context once the bound context module has an own `_context` property", () => {
        expect(hasOwnProperty(testContextModule, "_context")).toEqual(false);
        expect(hasOwnProperty(context2.test, "_context")).toEqual(true);
        expect((context2.test as any)._context).toBe(context2);
        expect((context2.test as any)._context).not.toBe(context1);
    });

    test("when cloning a context twice the bound context module has an own `_context` property", () => {
        expect(hasOwnProperty(testContextModule, "_context")).toEqual(false);
        expect(hasOwnProperty(context3.test, "_context")).toEqual(true);
        expect((context3.test as any)._context).toBe(context3);
        expect((context3.test as any)._context).not.toBe(context2);
        expect((context3.test as any)._context).not.toBe(context1);
    });

    test("when creating a context the bound context module has a prototype that\u2019s exactly the original context module", () => {
        expect(context1.test).not.toBe(testContextModule);
        expect(Object.getPrototypeOf(context1.test)).toBe(testContextModule);
    });

    test("when cloning a context once the bound context module has a prototype that\u2019s exactly the original context module", () => {
        expect(context2.test).not.toBe(testContextModule);
        expect(context2.test).not.toBe(context1.test);
        expect(Object.getPrototypeOf(context2.test)).toBe(testContextModule);
    });

    test("when cloning a context twice the bound context module has a prototype that\u2019s exactly the original context module", () => {
        expect(context3.test).not.toBe(testContextModule);
        expect(context3.test).not.toBe(context1.test);
        expect(context3.test).not.toBe(context2.test);
        expect(Object.getPrototypeOf(context3.test)).toBe(testContextModule);
    });
});
