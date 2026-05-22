Build a Zetamac-style mental-math web app as a PWA, intended to live on my iPhone home screen.

Reference: screenshots/ contains screenshots of an iOS Zetamac clone. Match its functionality and layout — don't worry about pixel-matching the design. Start by reading every image in that folder and summarizing back to me which screens/states you've identified before writing code.

Stack: single index.html + vanilla JS + minimal CSS. No frameworks. Service worker for offline. IndexedDB for storage. One repo, deployable to GitHub Pages.

Core game:

Configurable operand ranges per operation (+, −, ×, ÷), matching the original Zetamac's Game Options screen.
2-minute countdown by default (also configurable).
Auto-advance on correct answer — no submit button. Listen on the input event and check after each keystroke.
Pre-generate a queue of ~20 problems so there's never a frame hitch.
inputmode="numeric", autocomplete="off", autocorrect="off", spellcheck="false" on the input.
touch-action: manipulation on tap targets.
navigator.vibrate(50) on wrong answers.
The diagnostic feature (this is the whole point of building my own):

Log every problem to IndexedDB: { sessionId, timestamp, operation, operand1, operand2, correctAnswer, userAnswer, wasCorrect, msToAnswer }.
After each game, show a per-operation breakdown table: op, count, avg ms, error count. Highlight the slowest op.
Stats screen aggregates this across all sessions so I can see which operation is my consistent bottleneck.
Other screens (match what's in the screenshots): home / start, game options, settings, previous games list, statistics, personal bests.

Export: a "Download CSV" button that emits one row per problem across all sessions. This is non-negotiable — it's how I will get data into my tracking spreadsheet.

Process:

Read screenshots, summarize screens/states identified, ask me any clarifying questions.
Propose the file structure and IndexedDB schema before coding.
Build incrementally — game loop first, then persistence, then stats, then PWA shell (manifest + service worker) last.
After each milestone, tell me how to test it (e.g. python -m http.server and which URL to open).
