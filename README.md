# Aivora Internal Test Build

Fastest usable internal build for:
- German Recording
- Wake Word

## Included
- Upload one audio file at a time
- Basic QC indicators
- Naming generation
- Speed / silence / gain controls
- Export to 48 kHz / 32-bit float WAV
- Basic dashboard / QC / export screens

## Run
1. Install Node.js 18+
2. Open terminal in this folder
3. Run:
   npm install
   npm run dev

## Notes
- Internal test build only
- No backend or Firebase wiring in this zip
- Export is browser-side WAV float32 at 48kHz
