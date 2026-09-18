# Local preview distribution

Skill Gaming World is the intended future download hub. This repository can now stage an allowlisted local preview without copying an installed companion, game saves, photos, journal databases, credentials, or development files.

Run `node tools/build-portable.mjs <new-output-directory>`. The new directory contains the local runtime and `PORTABLE-PACKAGE.json` with exact SHA-256 hashes. An existing destination is refused. Extracted users run `START.cmd` with Node.js 22.13 or newer already installed. This remains a source-based preview, not a signed installer or bundled Node runtime.

The manifest retains the current working product name. The final name and any donation destination await the owner's selection. Downloads remain free; payment is not required and no payment link is invented. Preparing a directory or archive does not publish it. No Skill Gaming World site or external release is modified by this command.

The map imagery remains remote and optional. Publisher approval and broader redistribution rights are not asserted. The original project's notices remain in the download.
