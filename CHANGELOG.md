# Changelog

## v1.3.18

- **Proactive 403 Error Prevention**: The spoofer now validates your Roblox cookie immediately upon starting, aborting with a clear error if it's expired, rather than wasting time attempting downloads.
- **Persistent Place ID Cache**: Successfully verified place IDs are now saved to disk. Future runs will try these proven IDs first, completely skipping the slow "Discovering compatible places" phase and avoiding bad place IDs that cause 403s.
- **Pre-Flight Place Context Warning**: If the spoofer cannot find any accessible places for a creator, it will now warn you *before* downloading starts, giving you a chance to add an Override Place ID for private assets.
- **Smarter Auth Error Messaging**: JSON-level access-denied errors from Roblox are now properly detected, resulting in clean "Authentication failed" or "Access denied (403)" messages instead of generic "No assets processed" errors.
- **Plugin Server & Local Features**: Fixed issues with the Localhost Plugin Server and finalized local features to improve stability and workflow testing.
- **Fixed "Select Download Folder" Bug**: Resolved an issue where selecting a custom download directory in the UI would fail to apply the chosen folder properly due to an IPC data parsing mismatch.
- **Fixed Studio Plugin Scan Mismatches (403 Errors)**: Fixed a critical bug where the Studio plugin incorrectly captured audio IDs during an Animation scan (and vice versa).

## v1.3.17

- **Full React UI Migration**: Completely rebuilt the application's user interface from the ground up using React, Chakra UI, and Vite.
- **Desktop Backend Migration**: Greatly accelerated Roblox Studio scans. The Studio Plugin now acts as a high-speed vacuum, ripping every potential ID out of your game in bulk and offloading the heavy lifting of API validation to the Desktop App, preventing timeouts.
- **Upload Speed Boost**: Cranked up the concurrency limits and batch chunk sizes under the hood. Mass-uploading and downloading assets is now significantly faster and more aggressive out of the box.

## v1.3.16

**Massive Boost to Private Animation Downloads**: The spoofer is now significantly smarter at finding private animations. If a creator has their animations locked down and doesn't have any public games on their profile, the spoofer will now automatically scan their groups, group owners, and friends list to track down the exact game the animations were made for. This means drastically fewer "403 Forbidden" errors and more successful downloads.

**Smarter "Override Place ID"**: Added Fail-safes If you manually enter an "Override Place ID" and it turns out to be wrong or fails, the spoofer won't just give up anymore, and Instead it will use the new smart-search system to try and find the correct place ID.

**Faster Batch Downloads**: Upgraded how the spoofer remembers information during a batch download. It now smartly caches the places it finds, meaning large batches of animations from the same creator will download significantly faster.

## v1.3.15-hotfix.2

- Improved asset metadata handling, place context tracking, and payload validation across the main process and plugin.
- Refactored resolve/fetch logic to return richer metadata and added helpers for place ID normalization, batch locations, asset parsing, and validation.
- Improved download handling with audio payload validation/renaming, direct-URL fallback retries, and better mixed-success batch behavior.
- Updated upload validation to catch invalid payloads before network requests and report non-retryable errors.
- Updated localhost and Studio plugin output formatting to include optional [Place:<id>] context.

## v1.3.15-hotfix.1

- Fixed asset downloads failing with 403 "User is not authorized to access Asset" errors. The Studio identity headers (User-Agent, Roblox-Browser-Asset-Request) are now only sent when a Place ID is provided, matching the original working behavior. Without a Place ID, Roblox was rejecting requests that claimed Studio identity but lacked Studio context.
- Fixed uploads failing with 403 "User X is unauthorized to create an asset as User Y" when the cookie and Open Cloud API key belonged to different accounts. The app now auto-detects the API key's owner by probing the Assets API and uses that user ID as the upload creator instead of the cookie's user.
- Added an "API key owner" hint in the Profiles view. When you save a valid API key, the status message now shows the detected owner user ID so you can verify uploads will land on the correct account.
- Sped up uploads. The upload status poll interval dropped from 2 seconds to 500 ms so completed uploads are confirmed roughly four times faster. Tightened the rate-limit safety buffer and minimum start spacing so the app uses more of the Open Cloud quota without hitting 429s.

## v1.3.15

- **Cookie Expiration Fixes**: Updated internal systems to correctly accept and rotate Roblox's new `.ROBLOSECURITY` cookies during spoofing runs, preventing session drops caused by the mid-2026 platform changes.
- **Audio Spoofing Upgraded**: Legacy audio upload methods have been fully removed. All audio uploads now securely use the Open Cloud Assets API. _(Note: An Open Cloud API key is now strictly required for spoofing audio.)_
- **Better Stability**: Improved internal service structures, resulting in faster and more reliable downloads, uploads, and error handling.
- **Upload / Download Fixes**: Addressed various bugs affecting the transfer handlers, making overall asset processing more consistent.
- **UI/UX Improvements**: Minor UI Improvements/Changes

## v1.3.14-hotfix.1

- Fixed the weird Light theme thing
- Improved the plugins speed and scan reliability

## v1.3.14

- Added support for Roblox's 2026 `.ROBLOSECURITY` cookie rotation rollout. Cookie-authenticated requests now accept `Set-Cookie` updates, auto-detection supports newer cookie formats, and manual profile cookies are refreshed securely when Roblox rotates them. See [Roblox's announcement](https://devforum.roblox.com/t/upcoming-roblosecurity-cookie-format-changes/4328913).
- Added Open Cloud Asset Delivery and recommended Asset Delivery v2 fallbacks before the legacy v1 download routes.

* Fixed sound uploads being mislabeled as OGG. Downloaded sounds now preserve detected MP3, OGG, WAV, or FLAC formats, and downloaded animations are validated as RBXM or RBXMX before upload.

- Added bounded failed-transfer diagnostics for both sounds and animations. Invalid payloads and Roblox parse failures now stop immediately instead of repeating upload attempts.

* Fixed stale owned-asset lookups by scoping the in-memory index per account or group and clearing it at the start of skip-owned runs and through Clear App Cache.

- Increased default download concurrency, enlarged normal batch lookups, shortened download retry waits, and reduced conservative upload startup spacing while preserving adaptive Roblox rate-limit backoff.
- Windows builds are now code-signed using Azure Trusted Signing. Installers display a verified publisher (`ispoofermotion.com`) instead of an "Unknown publisher" warning, and Microsoft Defender SmartScreen reputation will build up over time across all signed downloads.
- Added a custom electron-builder signer (`scripts/azure-sign.js`) that authenticates to Azure with a service principal and signs the installer with SHA-256 + RFC 3161 timestamping.
- CI/CD now installs the Microsoft Trusted Signing client on the Windows runner and passes the required signing secrets through to the build step.

* Removed Replace Existing.

- Some other QOL stuff.

## v1.3.13-hotfix.2

- Sound spoofing is more reliable when using the Studio plugin. Scans now carry over the open game's Place ID automatically instead of making you enter it again.
- Improved automatic Place ID discovery. If Roblox does not return a usable place, the app now falls back cleanly instead of trying an unrelated experience.
- Added clearer progress updates for preparing, Place ID discovery, downloads, and uploads so larger jobs no longer look stuck at `0/100`.
- Made large Studio scans much faster by batching download lookups more efficiently when the open game's Place ID is known.
- Added smarter rate-limit handling so the app can move quickly while automatically easing off when Roblox reports that a limit is close.
- Expanded Studio plugin scans to find more animations and sounds stored in scripts, tags, attributes, grouped values, avatar descriptions, emote tables, newer AudioPlayer objects, and other custom setups.
- Sped up Studio plugin metadata checks so larger animation and sound scans finish sooner.
- Skipped Studio-only engine containers during plugin scans so the broader search spends less time on places that cannot contain game assets.
- Fixed rename settings not saving or applying consistently. Prefixes, suffixes, and find-and-replace rules now carry through to uploads.
- Fixed Studio scans picking up freshly spoofed copies after replacements were applied.
- Prevented duplicate jobs from starting while another spoof is already running.
- Improved profile saving, job history, and interrupted-session recovery.
- Added a completion notification when a job finishes. This still follows your notification setting.
- Fixed the built-in updater so hotfix releases are detected correctly.
- Cleaned up the Activity page and profile switcher so results, multiline details, and the active profile name stay in sync.

## v1.3.13-hotfix.1

- Fixed Roblox "Too Many Requests" errors by properly throttling batch requests and adding exponential backoff.

## v1.3.13

### Race Condition Fix - "A newer version was created from a different request"

- **Replace Existing uploads are now serialized (concurrency = 1).** Roblox was rejecting overlapping PATCH requests for the same asset when multiple workers raced to update it at the same time. Uploads with Replace Existing enabled now run one at a time to prevent this.
- **Fixed the concurrent uploads toggle.** When "Concurrent uploads" was disabled, the concurrency limit was still defaulting to 10 instead of 1.
- **Added a per-replacement async lock in the transfer layer.** Even if concurrency is accidentally raised in future code, only one PATCH operation per asset name/creator can be in-flight at a time.
- **Duplicate final-name guard for Replace Existing.** If two input animations resolve to the same upload name after applying rename prefix/suffix/find-replace, the run now stops early with a clear error listing the conflicts instead of silently overwriting each other.
- **Extracted rename logic into a shared `buildFinalUploadName()` helper** to eliminate duplicate code between `uploadOne` and `uploadFn`.

### Auto-Replace in Studio

- **New "Push to Studio" button** in the Output panel replaces the old Copy output / Copy retry input / Copy replacements buttons. After a spoof completes, clicking it queues the `oldId = newId` mappings directly to the Roblox Studio plugin.
- **Plugin auto-applies replacements** - the Studio plugin now polls `/pending-replacement` every 3 seconds. When a batch is waiting it automatically runs the replacement across the entire open place, then acknowledges via `/mark-replacement-applied`.
- **No widget interaction required** - polling starts immediately on plugin load, so the Replace widget does not need to be opened first.
- **Green "Auto-Replace: Active" indicator** in the Replace widget shows the polling state, switching to "Auto-Replace: Applying..." while a replacement is running.
- **App status bar confirms when Studio applied the replacements** (`Studio plugin applied the replacements ✓`).
- Three new localhost server endpoints: `POST /push-replacements`, `GET /pending-replacement`, `POST /mark-replacement-applied`.

### Activity / Jobs Panel

- **Fixed job output not displaying** - job cards were reading `job.result.output` which does not exist on the stored record; now correctly reads `job.output`.
- **Collapsed job cards now show a summary line** (Mode · Total · Downloaded · Uploaded) so you can see what a job did without expanding it.
- **Added "↺ Retry Failed (N)" button** on job cards that had failures. Clicking it re-runs only the failed asset entries from that job with the same settings, without needing to copy-paste anything.

- Replaced the old plugin UI with a localhost-based Roblox Studio plugin that exposes only Animations and Sounds toolbar scan buttons.
- Added the desktop app localhost scan receiver, automatic Asset IDs input population, and scan-complete desktop notifications.
- Updated app, renderer, plugin, and installer package metadata to 1.3.13.

## v1.3.12-hotfix.2

- **Large plugin output fix:** Studio plugin scan results are split into numbered output scripts when they exceed Roblox's script source length limit.
- **Hotfix version display:** The app sidebar now shows the hotfix release label for this build.

## v1.3.12-hotfix.1

- **Private asset fallback fix:** Direct downloads now include the resolved Roblox cookie when retrying private assets, so assets the current account can access do not fail after the normal metadata lookup misses them.
- **Download-only asset names:** Download mode now refreshes Roblox metadata before saving files, so both animation and sound downloads use the real asset names instead of falling back to asset IDs.

## v1.3.12

- **API key fixes:** Replacing an Open Cloud API key now properly overwrites the old key, validates the key when possible, and shows clearer messages for missing, invalid, expired, or permission-limited keys.
- **Profile fixes:** Updating a profile now fully replaces the old profile data instead of merging stale values back in, with safer saving so profile changes persist more reliably.
- **Animation and sound mapping fixes:** Improved processing so valid assets can still produce mappings when other assets fail, with clearer summaries for failed downloads/uploads instead of generic "no mappings" errors.
- **Better Place ID discovery:** Added automatic Place ID lookup from a User ID or Group ID, including multi-place suggestions and saving the selected place.
- **More reliable Place ID lookup:** Place search now tries more Roblox lookup paths, can fall back between user-owned and group-owned results for the same ID, and shows clearer next steps instead of failing with a generic "no places found" error.
- **Cookie auto-detect improvements:** Auto detect now checks Roblox Studio and browser profiles and uses whichever valid cookie it finds first.
- **Welcome tour improvements:** The welcome tour now appears on first launch and after new app versions.
- **Roblox Studio plugin fixes:** Improved ID extraction for animations and sounds, reduced scan throttling, and added better messages when IDs are found but Roblox metadata cannot confirm them.
- **Fresh plugin scans:** The Studio plugin now scans the live place each time instead of relying on indexing or cached scan results, so newly added or changed animation and sound IDs are picked up consistently.
- **Cleaner pasted plugin output:** The app now ignores the generated script wrapper, `TYPE:` marker lines, and whitespace-only or invisible formatting lines when pasted into the spoof input, preventing noisy invalid-line errors.

## v1.3.11

- **Interactive Welcome Tour:** Added a interactive onboarding tour to guide new users through setting up their cookies, API keys, and run options.
- **Advanced Asset Renaming:** You can now automatically rename your assets on upload using custom prefixes, suffixes, or find-and-replace rules (found in Settings -> Upload Engine Defaults).
- **Replace Existing Assets:** Added a new toggle to overwrite your existing creations instead of uploading duplicates.
- **Unified Roblox Plugin:** "Extract IDs" and "Replace IDs" are now housed together in a single window.
- **UI Upgrades:** Polished the UI design across the entire application and plugin.
- **Page Restorations:** Profiles, Settings, and Activity pages are now fully re-enabled with their complete feature sets.
- **Bug Fixes:** Fixed various layout quirks and Spoofer bugs.

## v1.3.10-hotfix.1

- Kept everything minimal until everything is PROVEN to work

## v1.3.10

- Fixed ISpooferLauncher showing the default Electron icon.
- Made ISpooferLauncher open an already installed ISpooferMotion much faster while it checks for updates in the background.
- Added a prompt when the testing fork has a newer update, with options to keep using the official release or switch to the fork build.
- Moved saved profile cookies and Open Cloud API keys into secure system credential storage.
- Kept app notifications under control by showing no more than four at once.
- Improved asset download fallback behavior for assets that Roblox does not return cleanly from the normal batch lookup.
- Made blocked/private source asset failures clearer so it is easier to tell when the current account or place does not have access.
- Made copied debug info safer by hiding sensitive account data and local user paths.
- Reverted to an older UI that was honestly better (Colours and certain button locations)
- Fixed animation ID processing that could incorrectly fail with Roblox private-asset errors even when the account/place had access.
- Improved fallback checks for source assets by retrying Roblox's place-aware asset lookup before falling back to direct downloads.
- Restored user-account uploads to always use the resolved Roblox user as the upload creator.
- Made upload setup stop early with a clear error when the app cannot resolve the Roblox user ID.

## v1.3.0

I'm too lazy to write a changelog, just know everything is better than it was before.

This is also the final big update before V1 goes into maintenance mode, so from here on out it’ll only be getting bug fixes, stability improvements, and small patches unless something major needs attention.

- Bye Incred UI, Hello Cody UI.

## v1.2.16

This update is mostly just polish. I spent like 12 hours doing all of this so enjoy.

### Launcher and installs

- Added a proper Electron launcher instead of the old console-style launcher.
- The launcher is now the main place to install, update, launch, and uninstall ISpooferMotion.
- Added automatic release checking from GitHub.
- Added automatic Roblox Studio plugin install from the release `.rbxmx` file.
- Added a deep uninstall button in the launcher (removes managed app files, old app data folders, shortcuts, temp files, and ISpooferMotion plugin files.).
- Cleaned up update/install leftovers after downloads finish.
- Made install/uninstall fail faster instead of sitting on Working forever when the release asset is wrong.
- Moved all launcher-created data folders to `ISpooferMotion` instead of lowercase/random names.

### Main app

- Added Profiles so common setups can be saved and reused.
- Profiles save account/settings stuff like cookie, Open Cloud API key, group ID, folders, retry settings, and concurrency settings.
- Profiles do not save animation/sound input lists or output results.
- Added a settings dropdown in the titlebar.
- Added a profiles dropdown in the titlebar.
- Added a Get button beside Open Cloud API Key that opens Roblox Creator credentials.
- Added queue and run report popouts so the main window is cleaner.
- Cleaned up the queue so it is easier to read during large batches.
- Cleaned up the run report and removed repeated footer/output text.
- Removed pointless footer status text that was already shown in the report.
- Added custom upload/download concurrency controls.
- Added custom scrollbars.

### Batch processing

- Fixed the raw Roblox cookie header in batch requests.
- Removed the old required CSRF fetch since the current upload flow does not need it.
- Added download concurrency limits.
- Added retry/cooldown handling for rate limits and temporary failures.
- Added a failed-item retry flow.
- Added project/session saving and restore support.
- Added an asset history cache for successful old ID to new ID mappings.
- Added fallback single-asset checks when batch lookup fails.
- Added better failure categories, including invalid cookie, invalid API key, asset access denied, rate limited, network failure, and file conversion failed.
- Changed source asset 403 errors so they show as asset access problems instead of blaming group permissions.

### Roblox Studio plugin

- Added support for the remade Get IDs UI.
- Added support for the remade Replace IDs UI.
- Added a build script so the workflow can turn the plugin source into a `.rbxmx` release asset.

### Releases

- Added a tag-based release workflow.
- Release builds now upload the launcher setup EXE, the managed app EXE, and the Roblox Studio plugin `.rbxmx`.
- Release notes now come from this changelog instead of needing to type them manually every time.

### Cleanup and safety

- Tightened external link opening so only expected trusted links can be opened.
- Tightened packaging so random build folders, downloads, launcher files, and repo metadata do not get bundled into the app.
