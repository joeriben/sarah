# Changelog

All notable changes to **transact-qda** will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes between point releases are possible until v1.0.

## [Unreleased]

## [0.7.0] - 2026-04-14 — Initial public beta

First public release. Feature-complete beta of the transactional QDA
platform. The core ontology, maps, documents, AI personas and export
pipelines work end-to-end. Rough edges remain and known bugs are tracked
in the project's memory notes.

### Added

- **Transactional ontology core.** Namings, participations, appearances
  and append-only designations replace the classical code/segment/project
  hierarchy. The Cue → Characterization → Specification (CCS) gradient
  is bidirectional and event-first.
- **Maps as projections.** Situational, Social-Worlds/Arenas and
  Positional maps share one data substrate; reification and unreification
  are per-map toggles rather than separate types.
- **Document viewer** with margin-based coding, memos (descriptive,
  analytical, organizational) and aggregated naming views
  (`/namings/[id]`).
- **Three AI personas** — Coach (didactic), Cowork (Socratic, opt-in)
  and Autonomous (batch, rollback-able per run). All AI writes are
  tagged with `aiPersona` / `aiRunId` for transparent provenance.
- **Provider-agnostic AI client** for seven providers (Ollama, Mistral,
  IONOS, Mammouth, Anthropic, OpenAI, OpenRouter) with per-project
  model configuration, API-key management via `*.key` files, and
  usage tracking at `/settings`.
- **QDPX export** (lossy interoperability format) with dual-namespace
  handling for cross-tool exchange.
- **DocNets** (virtual document sets) and **NamingNets / Phases**
  (virtual naming sets) for comparative analysis.
- **Authentication** with a forced password change for the default
  `admin` account on first login.
- **Instance branding** — logo, display name and impressum are
  configurable per deployment via `static/brand/`.
- **Embedding-model download progress** surfaced in the UI on first run.
- **Manual v2.0** covering Situational Analysis, Social-Worlds/Arenas,
  Positional Maps, memos, project management, QDPX export and AI
  providers, reachable via the `?` icon in the header.

### Licensing

- AGPL-3.0-or-later as the default license, with a separate commercial
  license on request (see `COMMERCIAL-LICENSE.md`).
- Inbound contribution arrangement: Apache-2.0 inbound / AGPL-3.0-or-later
  outbound, with DCO sign-off. See `CONTRIBUTING.md`.
- SPDX headers on all source files, NOTICE and `THIRD_PARTY_NOTICES.md`
  cataloguing 194 runtime and build dependencies.

[Unreleased]: https://github.com/joeriben/transact-qda/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/joeriben/transact-qda/releases/tag/v0.7.0
