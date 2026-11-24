"""Inspect one completed match through a running Windows League client."""

import argparse
import base64
import http.client
import json
import os
import re
import ssl
import subprocess
import sys
from pathlib import Path


class LookupError(Exception):
    """Safe diagnostic suitable for terminal output."""


def powershell(command):
    executable = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    result = subprocess.run(
        [str(executable), "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True, text=True, timeout=15, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def discover():
    processes = powershell(
        "ConvertTo-Json -Compress -InputObject @(Get-Process -Name LeagueClient,LeagueClientUx "
        "-ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path)"
    )
    if not processes:
        raise LookupError("Process discovery failed to query Windows.")
    records = json.loads(processes)
    if not records:
        raise LookupError("Process discovery found no running League client.")
    directories = set()
    for record in records:
        path = Path(record.get("Path") or "")
        if path.is_absolute() and path.name.lower() == record["ProcessName"].lower() + ".exe":
            directories.add(path.parent)
    if len(directories) != 1:
        raise LookupError("Process discovery could not identify a single League installation.")
    directory = directories.pop()
    try:
        parts = (directory / "lockfile").read_text(encoding="utf-8").strip().split(":")
    except (OSError, UnicodeError):
        raise LookupError("Lockfile missing or unreadable in the running client's directory.") from None
    if len(parts) != 5:
        raise LookupError("Invalid League lockfile.")
    name, pid, port, password, scheme = parts
    if (name != "LeagueClient" or scheme != "https" or not password
            or not pid.isdecimal() or not port.isdecimal() or not 0 < int(port) < 65536
            or not any(p["ProcessName"].lower() == "leagueclient" and str(p["Id"]) == pid
                       for p in records)):
        raise LookupError("Could not verify the League lockfile.")
    return directory, int(port), password, int(pid)


def get(client, route):
    directory, port, password, client_pid = client
    # Only this loopback socket uses the local self-signed certificate exception.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    connection = http.client.HTTPSConnection("127.0.0.1", port, context=context, timeout=10)
    try:
        connection.connect()
        peer_port = connection.sock.getsockname()[1]
        # Verify the server side of this exact established socket before sending auth.
        owner = powershell(
            f"$c=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort {port} "
            f"-RemoteAddress 127.0.0.1 -RemotePort {peer_port} -State Established "
            "-ErrorAction Stop; $process=Get-Process -Id $c.OwningProcess -ErrorAction Stop; "
            "if ($process.Path) { $process.Path } "
            f"elseif ($process.Id -eq {client_pid} -and $process.ProcessName -eq 'LeagueClient') {{ "
            # A protected LeagueClient can own the socket. Anchor its identity
            # to its visible UX child in the installation that supplied the lockfile.
            f"Get-CimInstance Win32_Process -Filter \"ParentProcessId={client_pid} AND Name='LeagueClientUx.exe'\" "
            "| ForEach-Object { $_.ExecutablePath } | Select-Object -Unique }"
        )
        if Path(owner) not in (directory / "LeagueClientUx.exe", directory / "LeagueClient.exe"):
            raise LookupError("Could not verify the local League connection owner.")
        auth = base64.b64encode(("riot:" + password).encode()).decode("ascii")
        connection.request("GET", route, headers={"Authorization": "Basic " + auth})
        response = connection.getresponse()
        if response.status in (401, 403):
            raise LookupError(f"Local authentication or access denied (HTTP {response.status}).")
        if response.status != 200:
            raise LookupError(f"HTTP {response.status}")
        try:
            return json.load(response)
        except ValueError:
            raise LookupError("Local endpoint returned invalid JSON.") from None
    except (OSError, http.client.HTTPException):
        raise LookupError("Local connection failed during TLS or HTTP communication.") from None
    finally:
        connection.close()


def report(match, game_id):
    if not isinstance(match, dict) or str(match.get("gameId")) != game_id:
        raise LookupError("Unexpected match response or mismatched game ID.")
    players = match.get("participants", [])
    teams = match.get("teams", [])
    print("Match retrieved. Ordinary custom game:", match.get("gameType") == "CUSTOM_GAME"
          if "gameType" in match else "unknown")
    print(f"Participants: {len(players)} (expected 10). Teams: {len(teams)}.")
    identities = [entry.get("player") or {} for entry in match.get("participantIdentities", [])]
    riot_ids = sum(bool(p.get("gameName") and p.get("tagLine")) for p in identities)
    puuids = sum(bool(p.get("puuid")) for p in identities)
    print(f"Identity records: {len(identities)}, complete Riot IDs: {riot_ids}, PUUIDs: {puuids}")
    groups = [
        ("Participant", players, ["teamId", "championId"]),
        ("Lane and role labels", [p.get("timeline") or {} for p in players], ["lane", "role"]),
        ("Player stats", [p.get("stats") or {} for p in players],
         ["win", "kills", "deaths", "assists", "goldEarned", "totalMinionsKilled",
          "neutralMinionsKilled", "totalDamageDealtToChampions", "visionScore",
          "damageDealtToObjectives"]),
        ("Team", teams, ["teamId", "win", "bans", "towerKills", "dragonKills", "baronKills",
                         "riftHeraldKills", "inhibitorKills", "hordeKills"]),
    ]
    for label, records, fields in groups:
        print(label + " field coverage (records containing a value):")
        for field in fields:
            count = sum(record.get(field) is not None for record in records)
            print(f"  {field}: {count}/{len(records)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-id", required=True)
    args = parser.parse_args()
    match_id = re.fullmatch(r"(?:[A-Za-z][A-Za-z0-9]*_)?([1-9][0-9]{0,19})", args.game_id)
    if not match_id or int(match_id[1]) >= 2**64:
        parser.error("Expected a positive numeric game ID, optionally platform-prefixed.")
    game_id = match_id[1]
    prefix = "/lol-match-history/v1/"
    client = discover()
    report(get(client, prefix + "games/" + game_id), game_id)
    try:
        timeline = get(client, prefix + "game-timelines/" + game_id)
        frames = timeline.get("frames") if isinstance(timeline, dict) else None
        print("Timeline frames:", len(frames) if isinstance(frames, list) else "unavailable")
    except LookupError as error:
        print("Timeline unavailable:", error)


if __name__ == "__main__":
    try:
        main()
    except LookupError as error:
        sys.exit(str(error))
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError,
            http.client.HTTPException):
        sys.exit("Local lookup failed. Check the running client and retry.")
