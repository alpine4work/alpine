# Content tables

[Content](content.internal.md) may include tables. We support both GFM table syntax and HTML table
syntax.

GFM syntax:

```md
| Item   | Quantity | Price |
| ------ | -------- | ----- |
| Apples | 3        | $2.00 |
| Bread  | 1        | $4.00 |
| Milk   | 2        | $3.00 |
```

HTML syntax:

```md
<table>
<thead>
<tr>
<th>

Item

</th>
<th>

Quantity

</th>
<th>

Price

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Apples

</td>
<td>

3

</td>
<td>

$2.00

</td>
</tr>
<tr>
<td>

Bread

</td>
<td>

1

</td>
<td>

$4.00

</td>
</tr>
<tr>
<td>

Milk

</td>
<td>

2

</td>
<td>

$3.00

</td>
</tr>
</tbody>
</table>
```

Often when you read a table it will be in HTML syntax. There are many cases when we fallback to HTML
syntax even though it's uglier:

- If the user has configured the table width or column widths
- If the table has multi-line markdown in any table cells
- If the table doesn't have a header row
- If the table has a header column

When you write a new table, we recommend using GFM syntax because it's simpler.

## Table with custom widths

All widths are subject to minimum/maximum width constraints. You set the widths with relative
numbers and then we translate that into pixel sizes based on where the table is rendered.

- Table width: `<table data-width="1.5">`. This number is a multiple of the content block width, so
  1 means "fit the table in the block width" and 1.5 means "fit the table in 150% of the block
  width".

- Column widths: `<table data-column-widths="2,1,3">`. Column widths are relative to each other.
  Think of them as `fr` units in CSS grid. For `data-column-widths="2,1,3"` 2 will occupy 1/3 of the
  table width, 1 will occupy 1/6 of the table width, and 3 will occupy 1/2 of the table width.

If you write a GFM table it gets appropriate column widths automatically based on the content you've
added. Which is why GFM tables are typically preferred.

## Table without header row

```md
<table>
<tbody>
<tr>
<td>

A1

</td>
<td>

B1

</td>
<td>

C1

</td>
</tr>
<tr>
<td>

A2

</td>
<td>

B2

</td>
<td>

C2

</td>
</tr>
<tr>
<td>

A3

</td>
<td>

B3

</td>
<td>

C3

</td>
</tr>
</tbody>
</table>
```

## Table with header column

Notice the "A" column is `<th>` instead of `<td>`.

```md
<table>
<tbody>
<tr>
<th>

A1

</th>
<td>

B1

</td>
<td>

C1

</td>
</tr>
<tr>
<th>

A2

</th>
<td>

B2

</td>
<td>

C2

</td>
</tr>
<tr>
<th>

A3

</th>
<td>

B3

</td>
<td>

C3

</td>
</tr>
</tbody>
</table>
```

## Table with header row and header column

We use `scope="col"` and `scope="row"` to communicate what dimension the `<th>` is heading since
`<th>` is used for both column headers and row headers.

```md
<table>
<thead>
<tr>
<th>

A1

</th>
<th scope="col">

B1

</th>
<th scope="col">

C1

</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">

A2

</th>
<td>

B2

</td>
<td>

C2

</td>
</tr>
<tr>
<th scope="row">

A3

</th>
<td>

B3

</td>
<td>

C3

</td>
</tr>
</tbody>
</table>
```
