# Ad-hoc

A directory for you to write ad-hoc scripts in our programming environment.

Add an `adhoc_local.ts` file with the code below and run with `bazel run //admin/adhoc`.

```ts
export function run() {
    console.log("Hello, world!");
}
```

The `adhoc_local.ts` file is ignored by git so you won't commit it. Every developer has their own
`adhoc_local.ts` file for running quick scripts.
