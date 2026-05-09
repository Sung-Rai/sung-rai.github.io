import json
import re
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent
INPUT_FILE = ROOT / "data" / "raw_history.tsv"
OUTPUT_FILE = ROOT / "data" / "presetGames.json"

ROLES = ["Top", "Jun", "Mid", "Adc", "Sup"]


def stable_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def parse_date(date_text: str) -> str:
    return datetime.strptime(date_text.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")


def main():
    raw = INPUT_FILE.read_text(encoding="utf-8").strip()
    games = []
    date_counts = {}

    for line_number, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue

        parts = [part.strip() for part in line.split("\t")]

        if len(parts) != 11:
            raise ValueError(
                f"Line {line_number} has {len(parts)} columns, expected 11. "
                "Make sure the file is tab-separated."
            )

        date_text = parts[0]
        names = parts[1:]
        played_at = parse_date(date_text)

        date_counts[played_at] = date_counts.get(played_at, 0) + 1
        game_number_for_day = date_counts[played_at]

        players = []

        # Positions 1-5 = winning Team A
        for index, name in enumerate(names[:5]):
            players.append({
                "id": stable_id(name),
                "name": name,
                "team": "A",
                "role": ROLES[index]
            })

        # Positions 6-10 = losing Team B
        for index, name in enumerate(names[5:]):
            players.append({
                "id": stable_id(name),
                "name": name,
                "team": "B",
                "role": ROLES[index]
            })

        games.append({
            "playedAt": played_at,
            "title": f"Historical Game {played_at} #{game_number_for_day}",
            "winningTeam": "A",
            "notes": "Imported from historical role/results table.",
            "players": players,
            "bans": []
        })

    output = {
        "games": games
    }

    OUTPUT_FILE.write_text(
        json.dumps(output, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print(f"Converted {len(games)} games.")
    print(f"Wrote: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()