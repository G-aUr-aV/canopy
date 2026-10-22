# Password login, 20 October 2026

The owner authorized replacing email OTP after recurring protected Quick Tunnel sign-in failures. Cloudflare's reported early expiry is consistent with the symptom; this app change removes that broker from the login path. It does not claim a Cloudflare fix.

## Account and state

- Username: `owner`. The installer generates a random temporary password in `/var/lib/canopy/initial-login.txt`; retrieve privately with `sudo cat /var/lib/canopy/initial-login.txt`.
- Initial login only permits session inspection, password replacement and logout. All private API reads return 428 until the owner chooses a password of at least 15 characters. The handoff file is deleted after replacement.
- `/var/lib/canopy/auth.json` contains only version, username, salt, scrypt hash and initial-change flag. scrypt uses N=2^17, r=8, p=1, a random 24-byte salt and a 64-byte result. Verification is serialized to bound memory. No database is introduced.
- The directory is 0700 and private files are 0600, owned by the dedicated service account. It is the sole app-writable disk directory (`StateDirectory=canopy`). The file browser cannot reach it; existing repository/vault/system mounts remain read-only. The observer's socket and permissions are unchanged.
- Opaque cryptographically random sessions and CSRF tokens stay in memory. Sessions have an absolute 24-hour lifetime, cap at 32, and use a `__Host-canopy_session` cookie with Secure, HttpOnly, Path=/ and SameSite=Strict. Restarting the web service invalidates sessions.
- Password changes require the current password and a CSRF token, atomically replace the private hash, revoke every existing session, and issue a fresh current session. Logout revokes the current session. Authentication tokens/passwords never enter browser storage.
- Exact Host and Origin checks, cross-site request rejection, no-store responses and a strict same-origin CSP remain active. Only login/password/logout accept POST; system and file mutations still return 405. Authentication JSON is bounded to 4 KiB and each text field to 1,024 bytes. A global limit of eight attempts/minute and sixty/hour cannot be bypassed with a forwarded IP header.
- Missing, malformed, world/group-readable or symlinked credential records fail closed. No default password or web-accessible initialization endpoint exists.

## UI

The login page shares the selected design's off-white canvas, forest-green accents, local Inter typography and generated brand mark. Desktop uses a quiet split composition; mobile stacks a compact introduction and touch-friendly form. Password visibility controls, password-manager autocomplete, specific error messages and first-password confirmation are supported. The app footer offers Password and Sign out. Auth expiry removes private views and polling, opens the login form and preserves the hash route.

Install app remains available after signing in. The public manifest and brand assets contain no private data, so browser installation no longer depends on the email broker. Native install prompts and browser-specific fallback instructions are retained; no private offline cache or service worker is added. A new tunnel hostname requires a new home-screen installation.

## Deploy, tunnel and recovery

Deploy the authenticated backend before replacing the email-protected connector. Verify every private endpoint returns 401 without cookies. Then stop only Canopy's existing tunnel and recreate it through `deploy/public_endpoint.py start`; its preflight refuses to publish an unconfigured or anonymous-readable app. The wrapper sets only Canopy's exact public Host and restarts its web service. The supported helper manages only the matching loopback target.

The random Quick Tunnel is temporary, has no boot startup service or uptime guarantee, and changes address when recreated. Keep Canopy, the connector and EC2 running. Use `python3 ~/workspace/repos/canopy/deploy/public_endpoint.py status|stop|start` for its lifecycle. Do not stop unrelated connectors.

To reset a forgotten password, stop the web service, run the scoped recovery tool as its account, then start the web service:

```sh
sudo systemctl stop canopy.service
sudo -u canopy /opt/canopy/venv/bin/python /opt/canopy/current/deploy/reset_password.py --reset
sudo systemctl start canopy.service
sudo cat /var/lib/canopy/initial-login.txt
```

This creates a new temporary password, invalidates the old password and all sessions, and requires first-password replacement again. The script never prints a password. Preserve any unfinished `initial-login.next` for inspection before recovery retry.

**Rollback boundary:** releases before this change have no app authentication. Stop Canopy's plain public tunnel before selecting one of those releases. Restore a verified email-protected gate before allowing public access to a pre-auth release. Keep the new service's private state; never copy credentials into a repository, vault or artifact.

## Verification

See the deployment readback in `~/workspace/ops/apps/canopy/VERIFICATION.md`. Backend auth/file tests and real local authentication browser checks run with disposable credentials. UI screenshots use signed-out views or invented data. The deployed loopback smoke test passed first login and password replacement, real measurements/services, read-only code/Markdown, session continuity, logout, and manifest/installability without saving private content or credentials. Public signed-out Chromium checks passed the password form, all six private API denials, a real external link and clean manifest/installability diagnostics. The owner then explicitly approved the public signed-in check. Chromium passed first login and mandatory password replacement through the live HTTPS tunnel, fresh metrics/services, read-only README source/Markdown, session continuity across polling and reload, logout denial, chosen-password re-login and secure cookie flags. Public manifest/installability diagnostics and installation instructions passed; no app exceptions or third-party requests occurred. The earlier automatic-review block is resolved. After that first-deployment check, the temporary test account password is replaced with a fresh private initial handoff and the web service restarted for the owner.

Physical phone installation, Safari, Firefox, screen readers, full reboot recovery and a wall-clock 24-hour session are outside the automated verification. Absolute expiry is tested with a controlled clock.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
