/* Build step (CI only — not shipped). Inlines app-logic.js into index.html so
   production serves ONE atomic resource. index.html and app-logic.js are cached
   independently by the service worker; a partial/stale update can otherwise
   leave a NEW index.html paired with an OLD app-logic.js (missing exports),
   which silently breaks every code path that touches the Z global. Folding the
   two into a single file makes that skew impossible.

   Usage: node build-inline.js <index.html> <app-logic.js>  (edits index in place) */
'use strict';
const fs = require('fs');
const [, , htmlPath, jsPath] = process.argv;
if (!htmlPath || !jsPath) { console.error('usage: node build-inline.js <index.html> <app-logic.js>'); process.exit(2); }

let html = fs.readFileSync(htmlPath, 'utf8');
const TAG = '<script src="app-logic.js"></script>';
if (!html.includes(TAG)) {
  console.error('inline failed: ' + JSON.stringify(TAG) + ' not found in ' + htmlPath);
  process.exit(1);
}
const js = fs.readFileSync(jsPath, 'utf8');
// function replacement so `$` sequences in the JS aren't treated as specials
html = html.replace(TAG, () => '<script>\n' + js + '\n</script>');
fs.writeFileSync(htmlPath, html);
console.log('Inlined ' + jsPath + ' into ' + htmlPath);
