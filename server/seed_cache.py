"""
Run this script from a machine that can reach stats.nba.com.
It fetches game listings for multiple seasons and saves them to
server/cache/ as JSON files. The Flask server loads these files before
falling back to an nba_api LeagueGameFinder request.

Usage (from project root, with venv active):
    python3 -m server.seed_cache --season 2025-26

The script will print progress and save files to server/cache/.
"""
import json
import argparse
import os
import sys

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

SEASONS = [f"{y}-{str(y+1)[-2:]}" for y in range(2025, 2013, -1)]
SEASON_TYPES = ["Regular Season", "Playoffs"]

def save(path, data):
    with open(path, "w") as f:
        json.dump(data, f)
    print(f"  saved {path} ({len(json.dumps(data))} bytes)")


def seed_games(seasons=SEASONS):
    from server.nba_client import _fetch_games
    failed = False
    for season in seasons:
        for stype in SEASON_TYPES:
            path = os.path.join(CACHE_DIR, f"games_{season}_{stype.replace(' ', '_')}.json")
            if os.path.exists(path):
                print(f"  skip {season} {stype} (already cached)")
                continue
            print(f"  fetching games {season} {stype}...")
            try:
                games = _fetch_games(season, stype)
                if not games:
                    raise RuntimeError("NBA returned no completed games; cache was not written")
                save(path, games)
            except Exception as e:
                failed = True
                print(f"  ERROR: {e}")
    return not failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", action="append", help="Season to fetch (repeatable)")
    args = parser.parse_args()
    print("Seeding games...")
    if not seed_games(args.season or SEASONS):
        sys.exit(1)
    print("\nDone. Files saved to server/cache/")
    print("Restart the Flask server to pick up the cache.")
