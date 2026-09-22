# PDF Viewer

## The important part

For the PDF list to automatically show files from `content/`, the website must be served by a web server.

Do NOT open `index.html` by double-clicking it if you want the `content/` library to work.

For example, with VS Code, install/use Live Server and open the site through:

    http://localhost:5500/

Or with Python:

    python -m http.server 8000

Then visit:

    http://localhost:8000/

## Adding PDFs

1. Put PDFs in `content/`.
2. Add them to `pdfs.json`.

Example:

    [
      {
        "file": "lecture1.pdf",
        "title": "Lecture 1"
      },
      {
        "file": "chapter2.pdf",
        "title": "Chapter 2"
      }
    ]

## Drag and drop

Dragging a PDF onto the page now reads the file directly with the browser's File API.
The PDF does NOT need to be uploaded to a server.

## Why the old version failed

The old version gave PDF.js a URL for the PDF. That can fail when the page is opened locally or when the server's fetch rules prevent the PDF from being fetched.

The new version downloads website PDFs as an ArrayBuffer and gives the bytes directly to PDF.js. Local dragged/selected PDFs use the same approach.

## Static hosting

GitHub Pages and other static hosts work with this setup.

The only thing a static host cannot do automatically is discover arbitrary files in the `content/` folder. Keep `pdfs.json` updated when you add a new PDF.

## PDF.js

The viewer uses PDF.js from cdnjs. An internet connection is therefore required for the PDF rendering library unless PDF.js is downloaded and hosted locally.


DOCUMENT TITLES AND COURSE CODES
---------------------------------
Each entry in pdfs.json can include:

{
  "file": "math.pdf",
  "title": "Calculus I Notes",
  "courseCode": "MATH 1010"
}

The course code and title appear in the library, the viewer header, and the document stays as a continuous scroll so you can scroll up/down through every PDF page.

PAGE SCROLLING
--------------
All pages of the selected PDF are rendered vertically in the viewer. The page indicator updates as you scroll, and the previous/next buttons smoothly jump to the adjacent page.


ADMIN VIEW
----------
Open viewer.js and find:

const AdminView = 1;

Set AdminView to 1 to allow local PDF opening and drag-and-drop.
Set AdminView to 0 for a read-only viewer. In AdminView 0, the local file picker, drag-and-drop functionality, and local PDF controls are hidden/disabled. Users can only open PDFs listed in pdfs.json.


SEARCH CONTROL PER PDF
-----------------------
pdfs.json supports an optional "searchable" setting for each PDF.

Use "searchable": true to show Find in PDF (this is the default if omitted).
Use "searchable": false to hide Find in PDF for that specific PDF.

Example:
{
  "file": "scanned-book.pdf",
  "title": "Scanned Book",
  "courseCode": "SOCI 1020",
  "searchable": false
}

This is useful for scanned/image-only PDFs that do not contain selectable text.
The PDF itself will still open and its pages can still be viewed normally.


AUDIO
-----
The viewer now uses the following audio files:

  music/PDF.wav              - looping PDF viewer background music
  sfx/highlight.wav          - button hover sound
  sfx/Popup.wav              - PDF opening sound
  sfx/ArrowButton.wav        - search navigation sound
  sfx/QuizSelect.wav         - refresh/select interaction sound
  sfx/PageFlip.wav           - previous/next page buttons and PageUp/PageDown

These paths follow the same sound-file organization used by the supplied
index.js. The uploaded index.js references the existing music and SFX files,
but the audio binaries themselves were not included with that upload. Put
your existing files into the music/ and sfx/ folders using the names above.

PDF.wav starts after the browser allows audio playback (normally the first
user interaction). It loops while the PDF viewer is open.
