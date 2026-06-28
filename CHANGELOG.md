# Changelog

## 0.5.12

- Materialize normalized default Traffic settings on first enable so a fresh
  install does not require a manual settings save.

## 0.5.11

- Align web asset cache keys, OpenAPI metadata, and install documentation with
  the package version.

## 0.5.10

- Replace the obsolete old Traffic keyword with current Traffic metadata.

## 0.5.9

- Finish renaming remaining legacy Traffic and engine terminology to AJRM Marine Traffic, including public projection mode values and diagnostics.

## 0.5.8

- Rename Traffic provider, subject keys, actions, and projection contracts to AJRM Marine naming.

## 0.5.7

- Track Logger replay warm-up separately from active replay, and suppress Traffic notifications while warm-up is active so replay can prime AIS state without speaking pre-voyage alerts.

## 0.5.6

- Use top-level Anchor CPA/TCPA thresholds when stale per-size CPA entries are zero, so edited anchorage guard settings affect collision evaluation.

## 0.5.5

- Omit MMSI-style fallback names from spoken encounter messages even when the Traffic projection has copied the MMSI into the target name field.

## 0.5.4

- Publish a speech-friendly encounter message that omits MMSI-only vessel identifiers while keeping the written notification text unchanged.

## 0.5.3

- Enable the stationary automute master switch and All's well reassurance by
  default on fresh installs, while preserving explicit off settings.

## 0.5.2

- Add per-profile stationary automute settings and expose them in the Traffic profile editor.

## 0.5.0

- Initial public beta release as AJRM Marine Traffic.
