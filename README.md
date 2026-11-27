# Killion's Record Shelf

A large-print record collection program for Windows 8, 8.1, 10 and 11.

- **Add a record** by dragging in a photo of the picture sleeve, choosing one from the computer, holding it up to the webcam, typing the name, or typing the barcode or catalog number.
- **Import a list**: bring in a CSV saved from Excel, Google Sheets or a Discogs collection export. Every record is looked up automatically (see below).
- **Sleeve pictures are fetched automatically** (front and back) from the free Cover Art Archive. Your own photo is used if there isn't one, and you can swap pictures at any time.
- **"Do I have the picture sleeve?"** Every record is marked Have picture sleeve / Need picture sleeve. Use the *Need a picture sleeve* filter as a shopping list.
- **Sleeve info**: songs by side, running times, label, catalog number, country, producer and other credits (from MusicBrainz).
- **Value** for the record's condition from real Discogs sales, with one-click links to Discogs and eBay sold listings.
- **Wish list**, **value report** (print, PDF or spreadsheet), **read aloud**, **three text sizes**, and **backup to a USB stick**.
- Everything is saved on the computer, so it works offline. The internet is only used for look-ups.

---

## Download the installer (easiest)

GitHub builds the installer automatically:

- **Releases** (right-hand side of the repo page): download `Killions-Record-Shelf-Setup-x.x.x.exe` from the latest release. No sign-in needed.
- **Actions** tab: every push to `main` builds a fresh installer. Open the newest run and download **Killions-Record-Shelf-Setup** under *Artifacts* (it comes as a .zip; you must be signed in).

To publish a release: on GitHub open **Releases → Draft a new release**, type a tag such as `v1.0.0` (choose *Create new tag*), and press **Publish release**. About 10 minutes later the installer appears on the release page. For later versions, update `"version"` in `package.json` first.

## 1. Or build the installer yourself (on any Windows 10/11 PC)

1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Unzip this folder somewhere, for example `Documents\record-shelf`.
3. Double-click **`Build-Installer.bat`**.
   The first run downloads the building blocks (a few minutes), runs the self-tests, then builds the installer.
4. When it finishes, the `dist` folder opens with **`Killions-Record-Shelf-Setup-1.2.0.exe`**.

That one installer works on Windows 8, 8.1, 10 and 11, in both 32-bit and 64-bit versions.

To try the program without installing it, double-click **`Try-Without-Installing.bat`**.

## 2. Install it on the record collector's computer

Copy `Killions-Record-Shelf-Setup-1.2.0.exe` over (on a USB stick, for example) and double-click it.
It installs without asking any questions, puts **Killion's Record Shelf** on the desktop and in the Start menu, and opens it.

**"Windows protected your PC"**: Windows shows this for any program that isn't code-signed. Click **More info** and then **Run anyway**.
To avoid the warning, sign the installer with a code-signing certificate. Set `CSC_LINK` (path to the .pfx) and `CSC_KEY_PASSWORD` before running the build, or add `certificateFile` to the `win` section of `package.json`.

## 3. Turn on values (free, about 2 minutes)

1. Make a free account at <https://www.discogs.com>.
2. Go to **Settings → Developers** (<https://www.discogs.com/settings/developers>) and press **Generate new token**.
3. In Killion's Record Shelf, open **Settings**, paste the token under *Record values*, and press **Save**.
4. Press **Test my Discogs key**. It says whether the key works and whether values by condition are turned on.
5. For values by condition (Like new, Very good, Good, Worn), fill in **Seller Settings** on the Discogs account once (<https://www.discogs.com/settings/seller>). You never have to sell anything.

The app looks for a value in this order, and labels which one it is showing:

1. **Your value**: typed on the record's form. This always wins.
2. **Worth about (condition)**: Discogs' suggested price for the condition you chose. Needs Seller Settings.
3. **Cheapest copy for sale now** of that exact pressing.
4. **Cheapest copy of any version** of the same album.

If none of these exist, the record shows the reason instead of a price. To check every record again, use **Update all values** on the Value report page.
Each look-up is written to `lookup.log` in the data folder (Settings → *Open the look-up log*), which shows exactly what Discogs answered.

## Importing a list he already has

1. In Excel use **File › Save As › CSV**, or in Google Sheets use **File › Download › CSV**. Put one record on each row.
2. In the app, press **Import a list** and choose the file, or drag it in.
3. Check the column guesses. Any column names work, such as *Artist / Band*, *Album / Title*, *Year*, *Label*, *Cat #*, *Barcode*, *Condition*, *Picture sleeve*, *Notes* and *Price paid*. A Discogs collection export is recognised as it is.
4. Press **Import**. Every row is saved immediately, then looked up one by one for songs, details, sleeve pictures and, if a Discogs key is set, its value.
   - The look-up takes about 4 seconds a record, or about 9 with values. You can keep using the app, or press **Stop for now** and **Continue** another day.
   - Barcodes and catalog numbers give the surest matches. A record that can't be matched for sure keeps what was in the list and is marked **Check this one**. Open it, press **Edit all the details**, then **Find this record online**.
   - Records already on the shelf are skipped.

## 4. Optional: read photos automatically

With an **Anthropic API key** (from the Claude Console), a photo of the picture sleeve is enough. Claude reads the artist, title, catalog number and barcode, and the app finds the record.
Each photo costs a small amount, usually around a cent. Paste the key under *Read photos automatically* in Settings.
Without a key, photos are still saved as sleeve pictures and you type the name or barcode instead.

Keys are encrypted with Windows' own data protection (DPAPI), stay on that computer, and are never copied into backups.

## Where things are saved

`%APPDATA%\Killion's Record Shelf\`
- `lookup.log`: what each value look-up found, for troubleshooting.
- `records.json`: the collection. A spare copy, `records.json.bak`, is kept automatically.
- `covers\`: the sleeve pictures.

Use **Settings → Back up my collection** to copy everything to a USB stick, and **Restore from a backup** on a new computer.

## Keyboard

- **Ctrl +** / **Ctrl −** / **Ctrl 0**: zoom in, zoom out, reset zoom
- **F5**: refresh the screen
- **F12**: developer tools, for troubleshooting

## For developers

```
npm install        # Electron 22 + electron-builder
npm start          # run it
npm test           # offline tests for look-ups and storage (no internet needed)
npm run dist       # build the NSIS installer (x64 + ia32) into dist\
```

- `main.js`: window, security settings, and the bridge to look-ups and files
- `preload.js`: the small, safe set of functions the screen is allowed to call
- `src/lookup.js`: MusicBrainz search and details, Cover Art Archive, Discogs prices, optional Claude photo reading
- `src/store.js`: JSON storage, cover files, encrypted keys, backup and restore
- `renderer/`: the interface (plain HTML, CSS and JavaScript)
- `test/`: offline tests, plus `ui.test.js` / `ui-mock.js` to click through the screen in a browser with sample data

**Why Electron 22:** it is the last Electron version that runs on Windows 7, 8 and 8.1. It no longer gets security updates. That is a small risk for an app that only contacts MusicBrainz, the Cover Art Archive, Discogs and Anthropic, and never shows outside web pages.
If every computer is on Windows 10 or 11, change `"electron"` in `package.json` to a current version and rebuild.

Record details come from MusicBrainz (CC0) and pictures from the Cover Art Archive; values come from the Discogs API. MusicBrainz asks apps to make no more than one request per second, and the app keeps to that.
