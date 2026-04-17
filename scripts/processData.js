import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const DATA_DIR = '/Users/sampath/Downloads/Clean Playoff Play-By-Play Data';
const OUT_DIR = path.join(process.cwd(), 'public/data');
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

// Win probability: logistic function on score differential adjusted for shots remaining.
// Returns 0-100 integer from perspective of teamA.
function winProb(scoreDiff, shotsRemaining) {
  // Scale factor: a lead matters more late in the game
  const k = 0.15 / Math.sqrt(shotsRemaining + 1);
  const p = 1 / (1 + Math.exp(-k * scoreDiff * 10));
  return Math.round(p * 100);
}

for (const year of YEARS) {
  const filePath = path.join(DATA_DIR, `${year} Play by Play Playoffs.csv`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  // Group by game ID
  const gameMap = {};
  for (const row of rows) {
    const gid = row['Game ID'];
    if (!gameMap[gid]) gameMap[gid] = [];
    gameMap[gid].push(row);
  }

  const yearGames = {};

  for (const [gameId, shots] of Object.entries(gameMap)) {
    // Determine the two teams (preserve order: first team to appear is teamA)
    const teamA = shots[0]['Team'];
    const teamB = shots[0]['Opponent'];

    // Build shot sequence and running score
    const scoreA = 0, scoreB = 0;
    let sA = 0, sB = 0;
    const total = shots.length;

    const shotSequence = shots.map((s, i) => {
      const pts = s['Attempt Type'] === '3 Pt' ? 3 : 2;
      const made = s['Result'] === 'Make';
      if (made) {
        if (s['Team'] === teamA) sA += pts;
        else sB += pts;
      }
      const shotsLeft = total - i - 1;
      return {
        i,
        team: s['Team'],
        player: s['Player'] || 'Unknown',
        quarter: parseInt(s['Quarter']),
        type: s['Attempt Type'],
        result: s['Result'],
        pts: made ? pts : 0,
        scoreA: sA,
        scoreB: sB,
        // Win prob for teamA after this shot
        wp: winProb(sA - sB, shotsLeft),
      };
    });

    // Win probability curve: one point per shot (plus starting point at 50%)
    const wpCurve = [{ idx: -1, wp: 50 }].concat(
      shotSequence.map((s) => ({ idx: s.i, wp: s.wp }))
    );

    yearGames[gameId] = {
      teamA,
      teamB,
      shots: shotSequence.map((s) => ({
        i: s.i,
        team: s.team,
        player: s.player,
        quarter: s.quarter,
        type: s.type,
        result: s.result,
        pts: s.pts,
        scoreA: s.scoreA,
        scoreB: s.scoreB,
      })),
      wpCurve,
      finalScoreA: sA,
      finalScoreB: sB,
    };
  }

  const outFile = path.join(OUT_DIR, `games-${year}.json`);
  fs.writeFileSync(outFile, JSON.stringify(yearGames));
  const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`${year}: ${Object.keys(yearGames).length} games → ${mb} MB`);
}

// Also write a lightweight index: year → list of { gameId, teamA, teamB, finalScoreA, finalScoreB }
// So the UI can populate dropdowns without loading all shot data
const index = {};
for (const year of YEARS) {
  const outFile = path.join(OUT_DIR, `games-${year}.json`);
  const yearGames = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  index[year] = Object.entries(yearGames).map(([gameId, g]) => ({
    gameId,
    teamA: g.teamA,
    teamB: g.teamB,
    finalScoreA: g.finalScoreA,
    finalScoreB: g.finalScoreB,
  }));
}
const indexFile = path.join(OUT_DIR, 'index.json');
fs.writeFileSync(indexFile, JSON.stringify(index));
console.log(`Index written to ${indexFile}`);
