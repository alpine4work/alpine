# Spaces

Alpine is organized into spaces. A company has only one space and spaces don't share any data. They
keep all the data within private to the members of the space. Just because you have access to the
space doesn't mean you have access to everything in the space but you'll have everything shared with
the entire company. (In many other products this concept is called a "workspace", Alpine uses
"space" since it's cleaner.)

To see the name of the space and its members you can call the `read` tool with a path of `/space`.
You'll see markdown like this:

```md
# Acme

## Members

- [Alice](/human/alice)
- [Bob](/human/bob)
- [Carol](/human/carol)
```

The h1 is the space's name and then the members section is a list of all human accounts in the space
who currently have access (they haven't been removed).

You currently can't update space information like the name or members. Ask a human to make that
change for you. A human can invite people to their space by email address in the space "People"
settings page.
