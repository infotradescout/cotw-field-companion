# FIELD — COTW Field Companion

An independent companion for **theHunter: Call of the Wild**. Free public reference tools, a local read-only career/harvest observer, and a private-in-browser share studio.

## Try the public field library

**[Open the web app](https://infotradescout.github.io/cotw-field-companion/)** — no account or player save required. Publication status is recorded in the latest GitHub activity; a source push alone is not proof the site is live.

Explore all 19 reserve rosters, 127 animal entries, score/weight/difficulty references, 1,771 species/sex fur-template entries, 129 weapon-variant rows, and 117 ammunition rows. Compare equipment or design a square, portrait or wide stat card/trophy collage with up to six photos. Reference counts describe the included snapshot, not a guarantee of future patch completeness.

## Run the local companion

Requires **Node.js 22.13+** on a compatible Windows PC. Download this repository, extract it, and double-click `START.cmd`, or run `node launcher.mjs --open` from its directory. The app listens on `http://127.0.0.1:47831`. Keep the process running while hunting. This is a source-based preview, not a signed installer.

The launcher discovers a single compatible save profile. It does not silently merge multiple player profiles. A nonstandard location can be selected with `COTW_SAVE_DIR`; companion storage remains separate. No third-party Node packages or paid service are required.

## Automatic tracking — manual notes optional

The local runtime reads compatible saved harvest receipts, discovered zones, equipment placements, named career statistics, and a narrow player-info projection. A new save updates the journal without requiring a manual form. Career counters and the retained recent-harvest ledger have different coverage and are displayed separately.

Career includes game-defined shots fired (hit + missed), accuracy and weapon-type accuracy, lifetime medal buckets, longest shot, and per-reserve exploration/progress. Duplicate statistics rows are deduplicated, conflicting rows are withheld, and inconsistent shot/accuracy totals are flagged rather than repaired by guessing.

**Kills are not harvests.** The saved current-unharvested counter is separate from lifetime claimed harvests. A validated lifetime-kill total and per-reserve shot/kill/harvest attribution are not available in the inspected schema. Population disappearance never becomes a confirmed kill. Automatic gunshot events and individual animal survival remain unvalidated.

## Share studio & privacy

Photos remain in browser memory. FIELD sends no photo upload, save upload, account identifier or journal data to the public site. PNG exports render a new image; the original photograph's file metadata is not copied. Review visible content before sharing. Custom stats are labeled player-reported; local career cards are labeled save-derived with their saved date. Neither is an official verified leaderboard record.

## Free preview, optional support, publisher ambition

Current tools are free. Optional donations are planned, but there is no configured payment destination and no payment requirement. Publisher review or an eventual DLC partnership is an aspiration, not an agreement. This project is not endorsed by Avalanche Studios Group or Expansive Worlds.

## Evidence & limits

A screenshot or passing unit-test count is not full product acceptance. The preview has source regression tests, a privacy-audited public build, and browser checks of the reference/share paths. Automatic counters have been exercised against a compatible Windows Steam save. Full console support, arbitrary multiplayer attribution, a signed installer, every historical patch and publisher approval are not claimed.

## Reference provenance

Animal score/weight/fur facts are derived from the [APC reference](https://github.com/RyMaxim/apc/tree/master/apc/config); its MIT notice is retained in `licenses/APC-MIT.txt`. Rare and very-rare tiers are clearly labeled companion reference categories, not exact live spawn odds. The optional local map imagery uses DECA only after consent.

Weapon/ammunition facts and statistic identifier mappings were independently normalized from the inspected game UI-stat definitions. Only short identifiers, names and numerical parameters are retained—not raw game archives, dialogue, graphics, audio or executables. Attribution is not a claim of publisher clearance; asset and distribution rights remain a review requirement before any official partnership or commercial package.

## Development

`npm test` runs isolated synthetic tests. `npm run build:web` projects an explicit allowlist into `docs/` for GitHub Pages. It never reads the installed user's app, game saves, screenshots or database. The public website uses the same reference and share modules as the local app; its entrypoint never calls local save APIs.

Report bugs in [Issues](https://github.com/infotradescout/cotw-field-companion/issues). Do not attach full saves or account identifiers. See `ROADMAP.md` for the retained product scope and `PUBLISHER_BRIEF.md` for evaluation goals.

Original code remains copyright 2026 infotradescout. The owner offers the current preview for personal use without charge; no transfer of ownership or commercial redistribution permission is implied. Third-party materials retain their own licenses. A final distribution license and contribution terms must be settled before broad commercial distribution. This is not described as unrestricted open-source software.
