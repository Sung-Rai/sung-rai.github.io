# Windows custom match lookup

## Website preview

1. Open League and sign in on the Windows PC you will use for KeamKxN.
2. Double-click `start_lcu_companion.cmd` in this folder. The launcher needs Python 3 and the Windows `py` command. Keep the window open.
3. Open KeamKxN and sign in as an administrator. In **Add Game → Game ID**, paste the code shown in the companion window and click **Pair Companion**. Grant the browser's normal loopback access prompt if it appears.
4. Enter a completed custom 5v5 Game ID and click **Retrieve Game**. A dash means the field was unavailable. The preview stays in the tab until disconnect, sign-out, expiry, navigation away or a new lookup.

Pair once per browser tab and retrieve multiple games during the 15-minute window. The window starts when the companion launches. Pairing or retrieving a game does not extend it. Disconnect, sign-out, or leaving the page clears the browser's pairing. The code remains valid on the companion until expiry or shutdown. Keep it private. Close the window or press Ctrl+C when finished, then restart the companion for a fresh code.

The double-click launcher defaults to the hosted site. Its PowerShell equivalent from the repository root is `py -B KeamKxN/tools/lcu_companion.py`. Use `--dev` only for the local test described below.

### Test the site locally

From the repository root, run the following in PowerShell. It serves a temporary copy of only the public site assets on loopback. Keep the server running.

```powershell
$site = Join-Path ([IO.Path]::GetTempPath()) ("keamkx-preview-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $site 'data') | Out-Null
Copy-Item KeamKxN/index.html,KeamKxN/css,KeamKxN/js,KeamKxN/assets -Destination $site -Recurse
Copy-Item KeamKxN/data/presetGames.json -Destination (Join-Path $site 'data')
py -m http.server 8000 --bind 127.0.0.1 --directory $site
```

In a second PowerShell window at the repository root, run `py -B KeamKxN/tools/lcu_companion.py --dev`. Open `http://127.0.0.1:8000/`, sign in using the normal KeamKxN administrator flow, and follow the preview instructions above. Local testing still uses the site's existing Supabase sign-in.

If your server is already running from the repository root and you are using `http://127.0.0.1:8000/KeamKxN/`, restart just the companion with `py -B tools/lcu_companion.py --dev` from the `KeamKxN` directory and use the new code. Both URL paths share the same origin. Default mode only accepts the hosted HTTPS origin, so its preflight rejects the local page. Use the literal address `127.0.0.1` and port `8000`.

Exercise **Retrieve Game** with a known completed game and with an unavailable ID. Switch back to **Manual Entry** and check that the original form is available. Check that **Import** still has its JSON and preset controls. Confirm disconnect and sign-out clear the preview. Run the automated tests with `py -B -m unittest discover -s KeamKxN/tools -v`.

A real Windows browser test at `http://127.0.0.1:8000/KeamKxN/` succeeded with the normal Supabase administrator sign-in, League running, and the companion started with `--dev`. Game `8055713072` displayed both teams, all ten Riot IDs, champions, KDA, gold, CS, damage, vision, bans and objectives. The hosted HTTPS test is pending.

The preview uses the Recent Games layout. Expand **Match details** to compare final player totals. Team objective totals appear in the scoreboard beside six original SVG symbols bundled with KeamKxN. Champion and ban portraits use the existing Data Dragon index.

### Hosted acceptance test

Use an owner-approved build on the exact hosted origin. Local development and GitHub's PR page cannot serve as the hosted acceptance test.

1. On the Windows PC running League, sign into an account that played the test game and double-click `start_lcu_companion.cmd`. Confirm the allowed origin is `https://sung-rai.github.io`. Hosted mode runs without `--dev`.
2. Open `https://sung-rai.github.io/KeamKxN/` in Chrome and repeat in Edge. First check that a signed-out or non-admin visitor cannot open the admin controls. Sign in as an admin, open **Add Game → Game ID**, deny the normal loopback prompt and confirm pairing fails. Then allow loopback through the site's browser permissions and retry.
3. Confirm a wrong code fails, then pair with the current code and retrieve a game the signed-in account played. Compare the scoreboard with the CLI. Confirm disconnect and sign-out clear the preview, and that a code expires 15 minutes after companion startup.
4. Confirm the lookup stays on `127.0.0.1:8765` and that the preview performs no Supabase writes. Share pass/fail results only. Keep pairing codes, authorization headers, Riot IDs and network captures private.

Riot requires products to be registered and feature changes to be submitted for audit. Register KeamKxN or note the LCU endpoints and preview flow on its existing Developer Portal application before wider rollout. Confirm the custom-match privacy and Riot Sign On requirements for the intended audience with Riot. The preview is designed for private review and the Riot policy requires League-specific player opt-in for public custom-match history. [League Client API](https://developer.riotgames.com/docs/lol#league-client-api) · [Product Registration](https://developer.riotgames.com/policies/general#product-registration) · [League game policy](https://developer.riotgames.com/docs/lol#game-policy)

## CLI coverage report

Open League and sign in. From the repository root, run the following in PowerShell with Python 3 installed. The Windows launcher is `py`.

```powershell
cd KeamKxN
$gameId = Read-Host 'Enter the ID of a completed custom game you played'
py tools/lcu_match_test.py --game-id $gameId
py tools/lcu_match_test.py --game-id invalid
py tools/lcu_match_test.py --game-id 0
py tools/lcu_match_test.py --game-id 1
py -B -m unittest discover -s tools -v
```

The CLI accepts a positive numeric ID or a platform-prefixed ID. The prefix is stripped locally, so use an ID from the signed-in client's platform. The inputs `invalid` and `0` should each exit with code 2 before discovery. ID `1` passes input validation and returned HTTP 404 in the live test. Use `$LASTEXITCODE` immediately after a command to see its exit code.

For a controlled nonparticipant test, have a consenting group supply the ID of a completed test game on the same platform that your account sat out. Keep your own account signed in.

```powershell
$otherGame = Read-Host 'Enter the agreed test game ID'
py tools/lcu_match_test.py --game-id $otherGame
```

Record the match status and timeline status separately. A 404 can indicate an unavailable game or an incorrect ID. A single success or failure establishes visibility for that account and game only. A successful match lookup can exit with code 0 even when the optional timeline is unavailable.

## Verified coverage

| Live Windows test | Match result | Timeline |
| --- | --- | --- |
| `8055713072` | Retrieved both teams and all 10 participants | 31 frames |
| `8055684427` | Retrieved all 10 participants, 10 complete Riot IDs, 10 PUUIDs and all listed scoreboard fields | 25 frames |
| `1` | HTTP 404 | Skipped after the match error |
| Game the signed-in account sat out | Untested | Untested |

The CLI prints counts and field coverage. Zero counts for kills or objectives are valid values. Empty ban lists or placeholder role labels can still count as present.

- All ten identity records contained `gameName`, `tagLine` and `puuid`. Within a match, join identity and scoreboard records by `participantId`.
- Participant `timeline.lane` and `timeline.role` were present for all ten. One team had two JUNGLE/NONE labels. The sample lacked participant-level `teamPosition` and `individualPosition`. Role assignments require independent confirmation.
- Final stats included champions, KDA, win/loss, gold, lane and jungle CS, champion damage, objective damage and vision. Team records included bans, towers, inhibitors, dragons, Heralds, Barons and grubs.
- Timestamped participant frames included current and total gold, XP, level, lane and jungle CS, and map coordinates. Use actual frame timestamps for checkpoint comparisons. Match participants to frame entries by participant ID. The sample included champion kill, building kill and elite monster kill events. Final vision score and champion damage came from the scoreboard.

## Local trust and limitations

The tool discovers the installation through running League processes, checks the lockfile PID and authenticates only after verifying the owner of the established loopback socket. The local TLS certificate exception is scoped to this connection. The two GET requests use neither proxies nor redirects. Credentials and raw responses stay in memory. Share the printed coverage or error message.

The CLI creates no exports. Keep any manually captured payloads outside the repository. Git also ignores `KeamKxN/data/raw_history.tsv` and `KeamKxN/tools/local-data/` for local-only data.

The LCU is an unsupported Windows-client dependency for this tool. Endpoint availability, payload fields and process visibility may vary.

## Architecture boundaries

- `lcu_match_test.py` discovers and authenticates to League, validates Game IDs, fetches matches and supports a separate timeline lookup.
- `lcu_companion.py` checks the loopback host, website origin and expiring code, then uses that retrieval code to produce a normalized scoreboard preview. The preview exposes only the fields needed by the website. Credentials, PUUIDs and raw responses stay local.
- `js/matchPreview.js` renders the preview from the companion's JSON. The existing legacy JSON Import tab still accepts its own preset format and uses its existing save flow.
- For the match-saving milestone, use a shared, versioned match format for direct retrieval and a future JSON file import. Validate either input before opening the same review and save flow. Keep the legacy Import format compatible. JSON export is deferred to that milestone.
