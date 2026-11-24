import http.client
import json
import threading
import time
import unittest
from unittest.mock import patch

from lcu_companion import Companion, DEV_ORIGIN, HOST, HOSTED_ORIGIN
from lcu_match_test import LcuHttpError


def example_match():
    return {
        "gameId": 123, "gameType": "CUSTOM_GAME", "platformId": "EUW1",
        "gameCreation": 1700000000000, "gameDuration": 1800,
        "participantIdentities": [
            {"participantId": 1, "player": {"gameName": "Example", "tagLine": "TEST",
                                          "puuid": "must-stay-private"}},
        ],
        "participants": [
            {"participantId": index, "teamId": 100 if index <= 5 else 200,
             "championId": 1, "stats": {"kills": 0}, "timeline": {"lane": "MIDDLE"}}
            for index in range(1, 11)
        ],
        "teams": [
            {"teamId": 100, "win": "Win", "bans": [{"championId": 7}], "towerKills": 0},
            {"teamId": 200, "win": "Fail"},
        ],
    }


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.server = Companion(HOSTED_ORIGIN, 0)
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.discover = self.enterContext(patch("lcu_companion.discover"))
        self.fetch = self.enterContext(patch("lcu_companion.fetch_match", return_value=example_match()))

    def request(self, path="/match", method="POST", payload=None, **overrides):
        headers = {
            "Origin": HOSTED_ORIGIN, "Authorization": f"Bearer {self.server.token}",
            "Content-Type": "application/json", "Sec-Fetch-Mode": "cors",
        }
        for name, value in overrides.items():
            if value is None:
                headers.pop(name, None)
            else:
                headers[name] = value
        connection = http.client.HTTPConnection(HOST, self.server.server_port, timeout=2)
        self.addCleanup(connection.close)
        body = json.dumps({"gameId": "EUW1_123"} if payload is None else payload)
        connection.request(method, path, body, headers)
        result = connection.getresponse()
        content = result.read().decode()
        return result.status, dict(result.getheaders()), json.loads(content) if content else None

    def test_paired_preview_is_normalized(self):
        status, _, pairing = self.request("/pair", payload={})
        self.assertEqual(status, 200)
        self.assertGreater(pairing["expiresIn"], 0)
        status, headers, result = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], HOSTED_ORIGIN)
        self.assertEqual(result["gameId"], "123")
        self.assertEqual(result["winningTeam"], 100)
        self.assertEqual([len(team["players"]) for team in result["teams"]], [5, 5])
        first = result["teams"][0]
        self.assertEqual(first["bans"], [7])
        self.assertEqual(first["objectives"]["Towers"], 0)
        self.assertEqual(first["players"][0]["riotId"], "Example#TEST")
        self.assertEqual(first["players"][0]["kills"], 0)
        self.assertIsNone(first["players"][0]["vision"])
        for value in ("must-stay-private", "participantIdentities", "timeline", self.server.token):
            self.assertNotIn(value, json.dumps(result))
        self.fetch.assert_called_once_with(self.discover.return_value, "123")

    def test_rejects_missing_wrong_and_expired_tokens(self):
        for token in (None, "Bearer wrong"):
            with self.subTest(token=token):
                self.assertEqual(self.request(Authorization=token)[0], 401)
        self.server.expires = time.monotonic() - 1
        self.assertEqual(self.request()[0], 401)
        self.fetch.assert_not_called()

    def test_rejects_wrong_origin_host_and_navigation(self):
        for invalid in ({"Origin": None}, {"Origin": "null"}, {"Origin": HOSTED_ORIGIN + ".example"},
                        {"Origin": DEV_ORIGIN}, {"Host": "localhost"}, {"Sec-Fetch-Mode": "navigate"}):
            with self.subTest(invalid=invalid):
                status, headers, _ = self.request(**invalid)
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.fetch.assert_not_called()

    def test_preflight_requires_expected_origin_and_post(self):
        headers = {"Access-Control-Request-Method": "POST", "Authorization": None}
        status, response_headers, _ = self.request(method="OPTIONS", **headers)
        self.assertEqual(status, 204)
        self.assertEqual(response_headers["Access-Control-Allow-Headers"], "Authorization, Content-Type")
        self.assertEqual(self.request(method="OPTIONS", Origin="null", **headers)[0], 403)
        self.assertEqual(self.request(method="GET")[0], 501)
        self.fetch.assert_not_called()

    def test_local_preflight_requires_dev_origin_configuration(self):
        preflight = {"Origin": DEV_ORIGIN, "Access-Control-Request-Method": "POST", "Authorization": None}
        self.assertEqual(self.request("/pair", method="OPTIONS", **preflight)[0], 403)
        self.server.origin = DEV_ORIGIN
        status, headers, _ = self.request("/pair", method="OPTIONS", **preflight)
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], DEV_ORIGIN)
        self.assertEqual(self.request("/pair", payload={}, Origin=DEV_ORIGIN)[0], 200)
        self.assertEqual(self.request("/pair", payload={}, Origin=HOSTED_ORIGIN)[0], 403)

    def test_bad_ids_and_large_body_do_not_reach_league(self):
        for game_id in ("../123", "0", "18446744073709551616", 123, ""):
            with self.subTest(game_id=game_id):
                self.assertEqual(self.request(payload={"gameId": game_id})[0], 400)
        self.assertEqual(self.request(payload={"gameId": "x" * 200})[0], 413)
        self.fetch.assert_not_called()

    def test_handles_unsupported_and_missing_matches(self):
        self.fetch.return_value["gameType"] = "MATCHED_GAME"
        self.assertEqual(self.request()[0], 422)
        self.fetch.side_effect = LcuHttpError(404)
        self.assertEqual(self.request()[0], 404)

    def test_rate_limit_counts_failed_authorization(self):
        for _ in range(12):
            self.assertEqual(self.request(Authorization="Bearer wrong")[0], 401)
        self.assertEqual(self.request()[0], 429)
        self.fetch.assert_not_called()
