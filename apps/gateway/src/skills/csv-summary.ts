import { createSkill } from "@mastra/core/skills";

/**
 * Reading a data file before answering questions about it.
 *
 * Without this a model tends to `head` the file and guess at the rest, or load a
 * large one whole and blow its context. The sandbox image ships pandas and
 * openpyxl, so there is a right way to do it — this is that way, written down.
 */
export const csvSummarySkill = createSkill({
    name: "csv-summary",
    description:
        "Inspect a CSV, TSV or Excel file before answering questions about it: shape, columns, types, missing values, and per-column statistics. Use whenever the user attaches or points to tabular data, or asks what is in a data file.",
    instructions: `# Summarising a data file

Never guess at a data file's contents from its first few lines. Load it properly,
report what it actually holds, and only then answer questions about it.

## Steps

1. Confirm the file exists and note its size: \`ls -l <path>\`.
   Files above ~200 MB should be read in chunks (see below) rather than whole.
2. Run the summary script below. It prints the shape, the columns with their
   types and null counts, statistics for numeric columns, and the most common
   values for the rest.
3. Report what the data *is* before answering anything about it — row count,
   column names, and any column that is mostly empty. A question about a column
   that turns out to be 90% null needs that fact in the answer.

## The script

Write it to a file rather than passing a long \`-c\` string, so quoting cannot
mangle it:

\`\`\`bash
cat > summarise.py <<'PY'
import sys, pandas as pd

path = sys.argv[1]
read = pd.read_excel if path.endswith((".xlsx", ".xls")) else pd.read_csv
df = read(path, sep=None, engine="python") if read is pd.read_csv else read(path)

print(f"rows={len(df)} columns={len(df.columns)}")
print()
print(df.dtypes.to_string())
print()
nulls = df.isna().sum()
print("missing values per column:")
print(nulls[nulls > 0].to_string() if nulls.any() else "  none")
print()
numeric = df.select_dtypes("number")
if not numeric.empty:
    print(numeric.describe().to_string())
    print()
for column in df.select_dtypes(exclude="number").columns[:10]:
    counts = df[column].value_counts().head(5)
    print(f"{column} — {df[column].nunique()} distinct, top values:")
    print(counts.to_string())
    print()
PY
python3 summarise.py <path>
\`\`\`

## Notes

- \`sep=None, engine="python"\` sniffs the delimiter, so the same call handles CSV
  and TSV. Do not assume a comma.
- If a numeric column loads as \`object\`, it has non-numeric values in it. Find
  them before coercing: \`df[col][pd.to_numeric(df[col], errors="coerce").isna()]\`.
- Large files: \`pd.read_csv(path, chunksize=100_000)\` and accumulate, or read the
  columns you need with \`usecols=[...]\`.
- An Excel file with several sheets: \`pd.ExcelFile(path).sheet_names\` first, then
  summarise each sheet that matters.
- Dates arrive as strings. Parse them explicitly with
  \`pd.to_datetime(df[col], errors="coerce")\` and report how many failed.`,
    references: {
        "pitfalls.md": `# Data file pitfalls

Things that produce a confidently wrong answer:

- **Assuming the delimiter.** A ".csv" exported from a European locale is often
  semicolon-separated with commas as decimal marks. \`sep=None\` sniffs it.
- **Assuming a header.** If the first row looks like data, it probably is:
  \`pd.read_csv(path, header=None)\`.
- **Silent numeric coercion.** \`errors="coerce"\` turns bad values into NaN
  without telling you. Count them and say how many.
- **Encoding.** A \`UnicodeDecodeError\` usually means cp1252, not utf-8:
  \`encoding="cp1252"\`. Try utf-8 first.
- **Duplicate rows.** \`df.duplicated().sum()\` before reporting totals; a report
  of "12,000 orders" is wrong if 400 are duplicates.
- **Mixed types in one column.** Pandas reports \`object\` and moves on. If a
  column matters, check what is actually in it.
- **Trailing whitespace in keys.** \`" Paris"\` and \`"Paris"\` group separately.
  \`df[col].str.strip()\` before any group-by on text.`,
    },
});
