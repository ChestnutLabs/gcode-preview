# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use **GitHub Private Vulnerability Reporting** for this repository:
**Security → Advisories → “Report a vulnerability”**
(<https://github.com/ChestnutLabs/gcode-preview/security/advisories/new>).

If private reporting is unavailable to you, contact the Chestnut Labs maintainers through a private
channel and request a secure reporting method before sharing any details. We will acknowledge your
report and coordinate a fix and disclosure timeline with you.

## Scope and what we treat as security work

This project parses and renders **untrusted files**. In line with the project governance, the following
are treated as security/reliability issues:

- Archive/container extraction flaws in `.gcode.3mf` or future container support — path traversal,
  zip-bombs/decompression bombs, entry-count or expanded-size limits, and malformed-archive handling.
- Parser resource exhaustion — memory blow-ups, unbounded work, or hangs on crafted G-code.
- Any input that causes code execution, arbitrary file access, or unexpected network requests. The
  parser must never `eval` or execute file-provided content, nor initiate fetches from file content.
- Leaks of secrets or private data into build output, Actions logs, demo URLs, or benchmark reports.

## Please **do not** attach exploit files to public locations

We do **not** require a public proof-of-concept file for exploitable archive/parser failures. Share
reproductions privately. If a fixture is needed for a regression test, we will produce a **sanitized,
minimized** fixture with recorded provenance.

## Supported versions

The project is pre-1.0 and under active foundation work. Until the first stable package line is
published (milestone M5), security fixes target the `dev` integration branch and the latest release
line. A formal supported-versions matrix will accompany the first stable release.

## Disclosure

We prefer coordinated disclosure. Please give us a reasonable window to release a fix before any public
write-up. Credit is offered to reporters who wish to be named.
