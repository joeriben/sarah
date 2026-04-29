# SARAH

> **S**tructured **A**nalysis, **R**eview, and **A**ssessment **H**elper —
> a local single-user workstation for structured analysis, peer review and
> assessment drafting on academic texts.

[![License: AGPL v3 or later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-on%20request-green.svg)](./COMMERCIAL-LICENSE.md)

SARAH is forked from [transact-qda](https://github.com/joeriben/transact-qda)
and adapted to a different research surface: instead of qualitative
coding (namings/participations/appearances), SARAH supports the
*hermeneutic, paragraph-level reading* of academic works under review,
with three documents per case (central work + reviewer annotation +
review draft).

The transact-qda foundation provides the document model, parsers, LLM
client, and frontend skeleton. SARAH-specific work concentrates on the
case-triade container, the sequential per-paragraph analysis pipeline,
and the review-drafting flow.

## Status

**v0.1 — fork in progress.** Inherits the transact-qda v0.7 baseline.
SARAH-specific modifications are layered on top in successive commits:

1. Branding (this commit).
2. Database backend swap PostgreSQL → SQLite.
3. Strip QDA-specific modules.
4. Add the case-triade schema and the per-paragraph analysis pipeline.

## Quick start

See `installation.txt` (inherited from transact-qda) — note that the
PostgreSQL stack will be replaced with SQLite in the next commit; until
then, the current install path is the transact-qda one.

## Author

Benjamin Jörissen, FAU Erlangen-Nürnberg
(allgemeine Pädagogik / ästhetische und kulturelle Bildung).
