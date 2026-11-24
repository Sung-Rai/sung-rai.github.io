"""Serve private custom match previews to a paired KeamKxN browser tab."""

import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import subprocess
import threading
import time

from lcu_match_test import LcuHttpError, LookupError, discover, fetch_match, parse_game_id


HOST = "127.0.0.1"
PORT = 8765
HOSTED_ORIGIN = "https://sung-rai.github.io"
DEV_ORIGIN = "http://127.0.0.1:8000"
PAIRING_SECONDS = 15 * 60
PLAYER_STATS = {
    "kills": "kills",
    "deaths": "deaths",
    "assists": "assists",
    "gold": "goldEarned",
    "laneCs": "totalMinionsKilled",
    "jungleCs": "neutralMinionsKilled",
    "damage": "totalDamageDealtToChampions",
    "vision": "visionScore",
}
OBJECTIVES = {
    "Towers": "towerKills",
    "Inhibitors": "inhibitorKills",
    "Dragons": "dragonKills",
    "Barons": "baronKills",
    "Heralds": "riftHeraldKills",
    "Void Grubs": "hordeKills",
}


def count(value):
    return value if type(value) is int and 0 <= value <= 2**53 - 1 else None


def riot_id(identity):
    name, tag = identity.get("gameName"), identity.get("tagLine")
    if all(isinstance(part, str) and 0 < len(part) <= 64 and part.isprintable()
           for part in (name, tag)):
        return f"{name}#{tag}"
    return None


def preview(match, game_id):
    if match.get("gameType") != "CUSTOM_GAME":
        raise LookupError("This game is not an ordinary custom match.")

    identities = {row["participantId"]: row.get("player") or {}
                  for row in (match.get("participantIdentities") or [])}
    players = {100: [], 200: []}
    for row in match["participants"]:
        stats = row.get("stats") or {}
        players[row["teamId"]].append({
            "riotId": riot_id(identities.get(row["participantId"], {})),
            "championId": count(row.get("championId")),
            **{name: count(stats.get(key)) for name, key in PLAYER_STATS.items()},
        })

    team_rows = {row["teamId"]: row for row in match["teams"]}
    if set(team_rows) != set(players) or any(len(team) != 5 for team in players.values()):
        raise LookupError("The client did not return a completed custom 5v5 scoreboard.")
    winning_teams = [team_id for team_id, row in team_rows.items() if row.get("win") == "Win"]
    teams = []
    for team_id, roster in players.items():
        row = team_rows[team_id]
        bans = [count(ban.get("championId")) for ban in (row.get("bans") or [])]
        teams.append({
            "id": team_id,
            "players": roster,
            "bans": [ban for ban in bans if ban],
            "objectives": {name: count(row.get(key)) for name, key in OBJECTIVES.items()},
        })

    return {
        "gameId": game_id,
        "createdAt": count(match.get("gameCreation")),
        "duration": count(match.get("gameDuration")),
        "winningTeam": winning_teams[0] if len(winning_teams) == 1 else None,
        "teams": teams,
    }


class Companion(ThreadingHTTPServer):
    def __init__(self, origin, port=PORT):
        self.origin = origin
        self.token = secrets.token_urlsafe(24)
        self.expires = time.monotonic() + PAIRING_SECONDS
        self.recent = deque()
        self.rate_lock = threading.Lock()
        self.lookup_lock = threading.Lock()
        self.connections = threading.BoundedSemaphore(8)
        super().__init__((HOST, port), Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address

    def process_request(self, request, address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.connections.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connections.release()

    def handle_error(self, request, address):
        # Request details and exception text may contain private information.
        pass

    def allow_request(self):
        with self.rate_lock:
            now = time.monotonic()
            while self.recent and self.recent[0] <= now - 60:
                self.recent.popleft()
            if len(self.recent) >= 12:
                return False
            self.recent.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_error(self, code, message=None, explain=None):
        # Avoid echoing a malformed request or unsupported method.
        self.send_response(code)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def header_is(self, name, value):
        return self.headers.get_all(name) == [value]

    def trusted_browser_request(self):
        return (
            self.header_is("Host", f"{HOST}:{self.server.server_port}")
            and self.header_is("Origin", self.server.origin)
            and (self.headers.get_all("Sec-Fetch-Mode") in (None, ["cors"]))
        )

    def reply(self, status, payload=None):
        encoded = json.dumps(payload).encode("utf-8") if payload is not None else b""
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if self.trusted_browser_request():
            self.send_header("Access-Control-Allow-Origin", self.server.origin)
            if self.command == "OPTIONS" and status == 204:
                self.send_header("Access-Control-Allow-Methods", "POST")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if encoded:
            self.wfile.write(encoded)

    def do_OPTIONS(self):
        if not self.trusted_browser_request():
            return self.reply(403)
        if self.path not in ("/pair", "/match") or not self.header_is(
                "Access-Control-Request-Method", "POST"):
            return self.reply(405)
        return self.reply(204)

    def do_POST(self):
        if not self.trusted_browser_request():
            return self.reply(403)
        if self.path not in ("/pair", "/match"):
            return self.reply(404)
        if not self.server.allow_request():
            return self.reply(429, {"error": "Too many requests. Wait a minute and try again."})
        auth = self.headers.get_all("Authorization") or []
        expected = ("Bearer " + self.server.token).encode("ascii")
        if (time.monotonic() >= self.server.expires or len(auth) != 1
                or not secrets.compare_digest(auth[0].encode("latin-1"), expected)):
            return self.reply(401, {"error": "Pairing code is incorrect or expired."})
        if not self.header_is("Content-Type", "application/json") or self.headers.get_all("Transfer-Encoding"):
            return self.reply(415, {"error": "Expected a JSON request."})
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            return self.reply(400, {"error": "Invalid request length."})
        if len(lengths[0]) > 3 or int(lengths[0]) > 128:
            return self.reply(413, {"error": "Request too large."})
        try:
            payload = json.loads(self.rfile.read(int(lengths[0])))
        except (ValueError, TimeoutError):
            return self.reply(400, {"error": "Invalid JSON request."})
        if self.path == "/pair":
            if payload != {}:
                return self.reply(400, {"error": "Invalid pairing request."})
            return self.reply(200, {"expiresIn": max(0, int(self.server.expires - time.monotonic()))})

        parsed = parse_game_id(payload.get("gameId")) if isinstance(payload, dict) else None
        if not parsed:
            return self.reply(400, {"error": "Enter a valid numeric or platform-prefixed Game ID."})
        if not self.server.lookup_lock.acquire(blocking=False):
            return self.reply(429, {"error": "A lookup is already running."})
        try:
            match = fetch_match(discover(), parsed["id"])
            if parsed["platform"] and parsed["platform"].upper() != match.get("platformId"):
                return self.reply(404, {"error": "This Game ID does not match the client's platform."})
            return self.reply(200, preview(match, parsed["id"]))
        except LcuHttpError as error:
            if error.status == 404:
                return self.reply(404, {"error": "Game unavailable. Check the ID and signed-in League account."})
            return self.reply(502, {"error": "The League client could not return this game."})
        except LookupError:
            return self.reply(422, {"error": "Could not retrieve a completed custom 5v5. Check League is open and signed in."})
        except (KeyError, OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
            return self.reply(502, {"error": "League returned an unexpected response or could not be reached."})
        finally:
            self.server.lookup_lock.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true", help="Pair only with http://127.0.0.1:8000.")
    args = parser.parse_args()
    try:
        with Companion(DEV_ORIGIN if args.dev else HOSTED_ORIGIN) as server:
            print(f"Allowed website origin: {server.origin}")
            print("Sign in as an administrator, then go to Add Game > Game ID.")
            print("Enter this pairing code. It expires after 15 minutes.")
            print(server.token, flush=True)
            print("Press Ctrl+C to stop. Restart the companion to get a new code.", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError:
        parser.exit(1, "Cannot start the local companion. Check whether port 8765 is already in use.\n")


if __name__ == "__main__":
    main()
