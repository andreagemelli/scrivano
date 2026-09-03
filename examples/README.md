# Sample document

`dichiarazione-residenza.pdf` — a two-page Italian municipal residence declaration
("Dichiarazione di residenza"), the sample input for Scrivano.

It carries every key the model was fine-tuned on: cognome, nome, data di nascita,
luogo di nascita, codice fiscale, indirizzo, comune, provincia, CAP, telefono,
email, sesso, cittadinanza, stato civile.

## Everything in it is fabricated

The comune, the person, the addresses, the protocol number, the codice fiscale,
the licence and plate numbers, the contract reference: all invented. The codice
fiscale is correctly *shaped* (6 letters, 2 digits, letter, 2 digits, letter,
3 digits, letter) but has a wrong check character and belongs to nobody. Email
addresses are on `example.it`, reserved for documentation. No real person, no
real municipality.

## Regenerating the PDF

The PDF is rendered from `dichiarazione-residenza.html` with headless Chrome:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --print-to-pdf=examples/dichiarazione-residenza.pdf \
  --no-pdf-header-footer --print-to-pdf-no-header \
  examples/dichiarazione-residenza.html
```

The CSS pins `@page { size: A4 }` and a fixed page height, so it must come out at
exactly 2 pages. If you edit the HTML, re-check the page count and that nothing
collides with the footer.

## Why it is a born-digital PDF

The app takes a page's text layer whenever it yields more than 50 characters and
only falls back to OCR below that (`src/pdf.ts`). This file has a text layer on
both pages, so it exercises the fast path; rasterizing page 1 and feeding it to
the real OCR pipeline also reads every field back correctly, so it works as a
stand-in for a scan too.
