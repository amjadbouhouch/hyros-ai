import { createSkill } from "@mastra/core/skills";

/**
 * Getting text out of a PDF, including a scanned one.
 *
 * The failure this prevents is specific: a model runs one extractor, gets an
 * empty string back from a scanned document, and reports that the PDF is empty.
 * The sandbox image carries the whole ladder — pdfplumber, pypdf, and OCR via
 * poppler + tesseract — so the right move is to climb it.
 */
export const pdfTextExtractSkill = createSkill({
    name: "pdf-text-extract",
    description:
        "Extract text from a PDF, including scanned or image-only pages, using pdfplumber with an OCR fallback. Use whenever a PDF's contents need to be read, searched, quoted, or summarised — and especially when a first extraction attempt comes back empty.",
    instructions: `# Extracting text from a PDF

An empty extraction almost never means an empty PDF. It means the pages are
images. Climb the ladder before concluding anything.

## Steps

1. **Look at the file first.**
   \`pdfinfo <path>\` gives the page count and whether it is encrypted.
   If encrypted without a password: \`qpdf --decrypt <in> <out>\` handles the
   common case of an owner password with no user password.

2. **Try the text layer** (fast, exact, keeps layout):

   \`\`\`bash
   cat > extract.py <<'PY'
   import sys, pdfplumber

   with pdfplumber.open(sys.argv[1]) as pdf:
       for number, page in enumerate(pdf.pages, 1):
           text = page.extract_text() or ""
           print(f"--- page {number} ({len(text)} chars) ---")
           print(text)
   PY
   python3 extract.py <path>
   \`\`\`

3. **Judge the result per page, not per file.** A report with scanned exhibits
   has both kinds of page. Any page that came back under ~20 characters needs
   step 4; the others are done.

4. **OCR the image-only pages:**

   \`\`\`bash
   cat > ocr.py <<'PY'
   import sys
   from pdf2image import convert_from_path
   import pytesseract

   path, pages = sys.argv[1], [int(n) for n in sys.argv[2:]]
   for number in pages:
       image = convert_from_path(path, dpi=300, first_page=number, last_page=number)[0]
       print(f"--- page {number} (ocr) ---")
       print(pytesseract.image_to_string(image))
   PY
   python3 ocr.py <path> 3 4 7
   \`\`\`

5. **Say which pages were OCR'd.** OCR misreads characters. Any figure quoted
   from an OCR'd page carries that uncertainty, and the user needs to know which
   ones those are.

## Notes

- **Tables** lose their structure in \`extract_text()\`. Use
  \`page.extract_tables()\` and load the result into pandas instead of trying to
  parse the flat text.
- **DPI matters for OCR.** 300 is the floor for body text; small print needs 400.
  Below 200 the error rate climbs sharply.
- **Rotated pages** OCR as noise. \`page.rotation\` tells you; rotate the image
  with \`image.rotate(-page.rotation, expand=True)\` before OCR.
- **Only English is installed.** \`tesseract --list-langs\` confirms it. Another
  language needs its traineddata, which is not in this image — say so rather than
  returning garbled output.
- **pypdf** (\`from pypdf import PdfReader\`) is the fallback if pdfplumber throws
  on a malformed file. It is less careful about layout but more tolerant.
- **Large PDFs**: work page by page. Converting 500 pages to images at 300 DPI at
  once will exhaust memory.`,
    references: {
        "checks.md": `# Before trusting an extraction

- **Page count matches.** \`pdfinfo\` said 40 pages; did you print 40?
- **No page silently empty.** Print the character count per page, as the script
  above does, so an empty one is visible rather than skipped.
- **Numbers spot-checked.** Pull two or three figures and confirm them against
  the rendered page: \`pdftoppm -f 3 -l 3 -r 150 -png <path> page\` then read the
  image.
- **Ligatures and hyphens.** Text layers often carry "ﬁ" as one glyph and break
  words across lines with hyphens. Normalise before searching:
  \`text.replace("ﬁ", "fi").replace("-\\n", "")\`.
- **Reading order.** Multi-column layouts can extract as interleaved lines.
  \`page.extract_text(layout=True)\` preserves the visual arrangement, which is
  easier to read but harder to parse.
- **Redactions.** A black box drawn over text does not remove the text; it will
  appear in the extraction. Do not treat it as public because it extracted.`,
    },
});
