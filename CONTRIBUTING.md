# Contributing to transact-qda

Thank you for considering a contribution. This project is a research tool
for qualitative data analysis built around a transactional ontology. We
welcome bug reports, feature proposals, methodological feedback, and
pull requests.

## Ways to contribute

- **Open an issue** for bugs, unexpected behavior, or proposals. Please
  describe what you expected, what happened, and how to reproduce.
- **Send a pull request** for code changes, documentation fixes, or new
  translations.
- **Discuss methodology** — the tool encodes specific commitments
  (Dewey/Bentley transactional ontology, Clarke's Situational Analysis,
  CCS-gradient designation). Methodological critique and alternative
  framings are as welcome as code.

## Pull-request checklist

Before submitting, please make sure:

- [ ] Your change is focused. One PR, one concern.
- [ ] The code typechecks: `npm run check` reports no new errors.
- [ ] New files carry the SPDX header used throughout the project:
  ```
  // SPDX-FileCopyrightText: <your name or handle>
  // SPDX-License-Identifier: AGPL-3.0-or-later
  ```
  (HTML-comment form for `.svelte` files.)
- [ ] You sign your commits with `git commit -s` (see *Licensing of
  contributions* below).
- [ ] You have not included generated files, build artifacts, `*.key`
  files, `.env` files, or entries under `static/brand/` other than
  `README.md` / `.gitkeep`.

Small, incremental commits with explanatory messages are easier to
review than large squashed changes.

## Licensing of contributions

transact-qda is licensed under
[AGPL-3.0-or-later](./LICENSE), and the copyright holder also offers a
separate [commercial license](./COMMERCIAL-LICENSE.md) to parties who
cannot comply with the AGPL's source-disclosure obligation.

To make that dual-licensing sustainable, contributions are accepted
under the following inbound arrangement:

> By submitting a contribution (pull request, patch, suggested code
> snippet), you license your contribution to the project under both:
>
> 1. **The Apache License, Version 2.0** (inbound), and
> 2. **The AGPL-3.0-or-later** (outbound, default license of the
>    project),
>
> and you permit the project maintainers to distribute your contribution
> under either of those licenses, as well as under the project's
> separate commercial license offering.

This is the "inbound = Apache-2.0 / outbound = AGPL or commercial"
pattern used by Grafana, Nextcloud, and many other dual-licensed open-
source projects. It lets the project remain AGPL for public users while
keeping the commercial option alive.

### How you signal this

Every commit must carry a **Developer Certificate of Origin** sign-off:

```
git commit -s -m "Your message"
```

This appends a line like:

```
Signed-off-by: Your Name <you@example.org>
```

By adding that line you certify that you have the right to submit the
code under the terms above. The full DCO text is at
<https://developercertificate.org/>.

If you are contributing on behalf of your employer, please make sure
you have the employer's permission to do so.

## Conduct

Be respectful, be patient with people at different levels of expertise,
and assume good faith. Methodological disagreement is welcome; personal
attacks are not.

## Contact

For questions that don't fit a GitHub issue — licensing inquiries,
security reports, academic collaboration — write to
**<benjamin.joerissen@fau.de>**.
