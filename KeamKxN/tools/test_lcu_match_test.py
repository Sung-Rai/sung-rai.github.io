import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import lcu_match_test as tool


class LookupTests(unittest.TestCase):
    def test_protected_client_with_visible_ux(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            records = [{"Id": 10, "ProcessName": "LeagueClient", "Path": None},
                       {"Id": 11, "ProcessName": "LeagueClientUx",
                        "Path": str(directory / "LeagueClientUx.exe")}]
            with patch.object(tool, "powershell", return_value=json.dumps(records)):
                with self.assertRaisesRegex(tool.LookupError, "Lockfile missing"):
                    tool.discover()
                lock = directory / "lockfile"
                lock.write_text("LeagueClient:10:10300:fictional:https")
                self.assertEqual(tool.discover(), (directory, 10300, "fictional", 10))
                lock.write_text("LeagueClient:12:10300:fictional:https")
                with self.assertRaisesRegex(tool.LookupError, "verify the League lockfile"):
                    tool.discover()

    def test_custom_coverage(self):
        data = {"gameId": 123, "gameType": "CUSTOM_GAME",
                "participants": [{"stats": {"kills": 0}} for _ in range(10)],
                "teams": [{"win": "Win"}, {"win": "Fail"}],
                "participantIdentities": [{"player": {"gameName": "fictional-name",
                    "tagLine": "demo", "puuid": "fictional-identifier"}}]}
        with contextlib.redirect_stdout(io.StringIO()) as output:
            tool.report(data, "123")
        for expected in ("custom game: True", "Participants: 10", "kills: 10/10",
                         "visionScore: 0/10", "win: 2/2", "complete Riot IDs: 1, PUUIDs: 1"):
            self.assertIn(expected, output.getvalue())
        self.assertNotIn("fictional-", output.getvalue())

    def test_wrong_game(self):
        with self.assertRaises(tool.LookupError):
            tool.report({"gameId": 25}, "123")

    def test_invalid_id_before_discovery(self):
        with patch("sys.argv", ["test", "--game-id", "../123"]), patch.object(
                tool, "discover") as discover, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                tool.main()
            discover.assert_not_called()

    def test_unverified_owner_and_redirect(self):
        directory = Path("League")
        with patch.object(tool.http.client, "HTTPSConnection") as constructor, patch.object(
                tool, "powershell") as owner:
            connection = constructor.return_value
            connection.sock.getsockname.return_value = ("127.0.0.1", 10500)
            owner.return_value = "unrelated.exe"
            with self.assertRaises(tool.LookupError):
                tool.get((directory, 10400, "fictional", 10), "/example")
            connection.request.assert_not_called()
            owner.return_value = str(directory / "LeagueClientUx.exe")
            connection.getresponse.return_value.status = 302
            with self.assertRaisesRegex(tool.LookupError, "^HTTP 302$"):
                tool.get((directory, 10400, "fictional", 10), "/example")
            connection.request.assert_called_once()
            self.assertEqual(connection.request.call_args.args, ("GET", "/example"))
            connection.getresponse.return_value.status = 401
            with self.assertRaisesRegex(tool.LookupError, "authentication.*401"):
                tool.get((directory, 10400, "fictional", 10), "/example")
            connection.connect.side_effect = ConnectionRefusedError("fictional secret")
            with self.assertRaisesRegex(tool.LookupError, "^Local connection failed during TLS or HTTP communication.$"):
                tool.get((directory, 10400, "fictional", 10), "/example")
