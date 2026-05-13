"""
Run this script from a machine that can reach data.nba.com.
It fetches game listings for multiple seasons and saves them to
server/cache/ as JSON files. The Flask server loads these files before
falling back to a live schedule request.

Usage (from project root, with venv active):
    python3 server/seed_cache.py

The script will print progress and save files to server/cache/.
"""
import json
import os
import sys

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

SEASONS = [f"{y}-{str(y+1)[-2:]}" for y in range(2024, 2013, -1)]
SEASON_TYPES = ["Regular Season", "Playoffs"]

def save(path, data):
    with open(path, "w") as f:
        json.dump(data, f)
    print(f"  saved {path} ({len(json.dumps(data))} bytes)")


def seed_games():
    from server.nba_client import _fetch_games
    for season in SEASONS:
        for stype in SEASON_TYPES:
            path = os.path.join(CACHE_DIR, f"games_{season}_{stype.replace(' ', '_')}.json")
            if os.path.exists(path):
                print(f"  skip {season} {stype} (already cached)")
                continue
            print(f"  fetching games {season} {stype}...")
            try:
                games = _fetch_games(season, stype)
                save(path, games)
            except Exception as e:
                print(f"  ERROR: {e}")


if __name__ == "__main__":
    print("Seeding games...")
    seed_games()
    print("\nDone. Files saved to server/cache/")
    print("Restart the Flask server to pick up the cache.")
