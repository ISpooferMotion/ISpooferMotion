# Security

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you've found something that could be exploited - unauthorized access to credentials, remote code execution, privilege escalation, or anything similar - please report it privately.

You can do this through [GitHub's private vulnerability reporting](https://github.com/ISpooferMotion/ISpooferMotion-V2/security/advisories/new), or by emailing [incredibroxpdev@gmail.com](mailto:incredibroxpdev@gmail.com).

Include as much detail as you can: what the issue is, how to reproduce it, and what the potential impact might be. You'll get a response within a few days.

## Scope

Areas most worth reporting:

- Credential leakage (cookies, Roblox tokens, Discord tokens)
- Path traversal or arbitrary file access via Tauri IPC
- Injection vulnerabilities in the Luau plugin or HTTP bridge
- Privilege escalation through the Windows credential store integration

Out of scope: UI-only cosmetic issues, general crashes without security implications, and anything specific to unofficial builds or forks.
