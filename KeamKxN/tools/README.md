# Windows custom match lookup

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
