Keep tests straightforward and easy to visually verify. Don't add small helper functions to try and
reduce test size, prefer verbose tests that you can immediately understand by reading them. Prefer
asserting on the full output of the CLI rather than matching a substring.

Below is an example of a good CLI integration test. It runs the CLI twice and includes the full
output inline which makes the test easy to visually verify.

```ts
test("read document created by the CLI", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube

YouTube launched on February 14, 2005.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube launch](/document/youtube).
`);

    expect(await cli.run("alpine read /document/youtube")).toEqual(`\
# YouTube

YouTube launched on February 14, 2005.
`);
});
```
