# Canopy

Canopy gives one owner a quick answer to “Is my EC2 machine healthy?” and a comfortable, read-only way to inspect its files from a computer or phone.

The owner selected the light overview concept and requested a collapsible desktop sidebar. The mobile design keeps that palette and hierarchy, adds bottom navigation, and gives file reading a full-width screen. Visual references are in `design/`.

## First release

| Area | Behavior |
| --- | --- |
| Overview | Host identity, OS, architecture, configured AWS region, uptime, CPU, memory, root disk, network, and observed services. |
| Resources | Per-core CPU, 1/5/15-minute load, available memory, page cache, buffers, swap, mount capacity, inodes, disk I/O, interface rates/errors/drops. |
| History | 5-minute, 15-minute and 1-hour windows over actual collected points. Missing history stays empty. A 1,800-point in-memory ring samples every two seconds. |
| Processes | Filter by name/PID/user and sort by CPU or memory. CPU is relative to one logical core. Command-line arguments and environments are excluded. |
| Services | Owner user-service states, descriptions and available active uptime. No service controls. A separate observer supplies only status. |
| Files | Approved locations, lazy folder tree, breadcrumbs, sorting, hidden-file toggle, filename filtering, and bounded subfolder search. |
| Reader | Language detection, syntax highlighting, line numbers, folding, find, go-to-line, wrap, copy, Markdown source/preview, metadata, and clear unavailable/protected states. |
| Mobile | Touch controls, five-item bottom navigation, one folder screen at a time, and a full-width reader with clear back navigation. |
| Reliability | Pause/resume, timestamps, reconnect/error messages, stale service state, and collector warm-up without fake zero measurements. |
| Access | Owner password login with a private scrypt hash and in-memory 24-hour sessions over a random Cloudflare Quick Tunnel; mandatory first password replacement, password change, sign out, same-origin account writes, read-only system/file APIs and no offline private-data cache. |

Filesystem browsing covers repositories, operations, vaults and readable `/etc` configuration. Protected names and paths, symlinks, non-regular files and detected credential material are rejected. Text previews are UTF-8 and limited to 256 KiB. Filename search is capped at 5,000 entries, six levels, 100 results and 1.5 seconds. These are read boundaries, not an assertion that all possible secrets can be detected by their contents.

## Storage and scope

There is no application database, saved file index, or retained monitoring history. The owner authorized one private salted password-hash file, with no credentials in the repository. Application sessions stay in memory with a 24-hour absolute lifetime. Sidebar preference uses browser local storage. The service observer exchanges a small status file in `/run`, which is volatile RAM-backed runtime state. Machine configuration and installed application files remain on the host.

Long-term history, external alerts, multi-server management, container inspection and AWS billing/credit APIs are outside this release. Discuss storage, permissions and integrations before adding them. The app cannot monitor its own host while that host is offline.

## Research, 20 October 2026

- [Cockpit](https://cockpit-project.org/) is the closest integrated server console. It supports administration and normal system logins; [Cockpit Files](https://github.com/cockpit-project/cockpit-files) adds file browsing.
- [Beszel](https://www.beszel.dev/guide/what-is-beszel) informs the calm resource overview and useful metric selection.
- [Netdata](https://learn.netdata.cloud/docs/welcome-to-netdata/complete-product-description) informs synchronized chart windows and freshness cues.
- [Glances](https://glances.readthedocs.io/en/latest/quickstart.html) provides a compact, responsive monitoring precedent.
- [File Browser](https://filebrowser.org/) provides familiar directory navigation, though this app excludes its write operations.
- [CodeMirror](https://codemirror.net/) provides language-aware, mobile-compatible code viewing and [explicit read-only settings](https://codemirror.net/examples/readonly/).
- Initially selected [protected Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) support email OTP on random hostnames without a Cloudflare account or domain. Their hostnames change after recreation, there is no uptime guarantee, and SSE is unsupported; Canopy polls instead.

The owner subsequently selected app-managed password login after repeated OTP session expiry. The random tunnel now carries HTTPS traffic while the app protects every private API. [Password architecture and recovery](PASSWORD_LOGIN.md).
