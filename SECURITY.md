# Security

## For researchers installing this on their own computer

**transact-qda is designed to run on your local research workstation.** It
is not hardened for exposure to the public internet. If you install it on
a laptop or desktop and use it yourself, you are fine. If you plan to put
it on a server that other people can reach over the internet, please ask
someone with IT-security experience to help you harden the setup first.

### The default admin password

When you first install transact-qda, the system creates an admin account
with username `admin` and password `adminadmin`. **This default is
well-known.** You must change it:

1. Log in with `admin` / `adminadmin`.
2. A yellow banner appears at the top of the screen.
3. Click *"Change password"* and pick your own password (at least 8
   characters).

The banner disappears once the password is changed. You will not be asked
again.

### Protecting your research data

- The database runs in a Docker container on your machine. Your data
  never leaves your computer unless you send it somewhere on purpose.
- AI provider API keys (if you configure any) are stored in `*.key`
  files in the project directory. These files are excluded from version
  control — do not copy them into any shared folder or cloud sync.

## For operators hosting transact-qda as a network service

If you deploy transact-qda behind a public URL:

- Always set `SESSION_SECRET` to a long random string (32+ bytes) in
  `.env`.
- Put the app behind HTTPS.
- Delete or rename the default `admin` account after you have created
  your own administrator.
- Review the dependency tree periodically (`npm audit`).
- The AGPL-3.0 license requires that if you run a modified version of
  transact-qda as a network service, you must make the modified source
  code available to users of that service.

## Reporting a security issue

If you find a vulnerability, please do **not** open a public issue. Write
to **<benjamin.joerissen@fau.de>** with a description and, if possible,
steps to reproduce. We will coordinate disclosure with you.
