const {
  expandBrowserCookieCandidates,
  readPossibleCookieFile,
  ROBLOX_COOKIE_PATTERN,
} = require('../src/main/services/auth.js');
const fs = require('node:fs/promises');

async function run() {
  const candidates = await expandBrowserCookieCandidates();
  console.log('Total candidates:', candidates.length);
  let found = 0;
  for (const file of candidates) {
    const cookie = await readPossibleCookieFile(file);
    if (cookie) {
      console.log('Found raw cookie in:', file);
      console.log('Cookie prefix:', cookie.substring(0, 100));
      found++;
    }
  }
  if (found === 0) console.log('No raw cookies found anywhere.');
}

run().catch(console.error);
