# ![Damecon icon](./packages/shell/browser/ui/assets/icons/damecon_icon_48.png) damecon-browser

A minimal, tabbed web browser for playing Kantai Collection, with integrated KC3Kai, a built-in KCCacheProxy and HTTP/SOCKS5 proxy support.

Built on [electron-browser-shell](https://github.com/samuelmaddock/electron-browser-shell).

![browser preview image showing a typical setup with the game open, KC3Kai visible in the developer tools panel, and some tools open in background tabs.](./screenshots/ingame.png)

## About this fork

This is a fork of [planetarian/damecon-browser](https://github.com/planetarian/damecon-browser), **focused on macOS**.

- **macOS is the maintained platform.** Releases ship builds for Apple Silicon and Intel Macs. CI also builds for Windows and Linux; those builds are untested.
- **Proxy and KCCacheProxy (KCCP) can be chained.** An HTTP/SOCKS5 proxy handles everything, and KCCP can sit in front of it for game servers only, so it works on networks where every connection needs a proxy. KCCP runs built in (its own downloads also use the proxy) or as an external instance.
- **Asset mods**: KCCP mods, classic `.hack` files and ship `config.ini` files (岛风GO format).
- **Electron 44.**
- **Updates**: new versions are published on the [Releases page](https://github.com/yecl/damecon-browser/releases); KC3Kai updates itself.

## ⚠️ Notice

#### Damecon is NOT intended to be used as a general-purpose browser.

Damecon is designed for one purpose only, and that is playing KanColle.

Damecon is built upon Electron, and lacks many of the security features of major browsers. Plus, I have no idea what I'm doing.

Seriously, I've literally never worked with Electron before. There's some real spaghetti-tier code going on here. Do you really wanna put your trust in that?

#### If you use Damecon for any activities involving sensitive information, you do so at your own risk.

## Usage

### From a Release build (macOS):

Requires macOS 13 (Ventura) or later.

From the [Releases page](https://github.com/yecl/damecon-browser/releases/latest), download `damecon-browser-*-arm64.dmg` (Apple Silicon) or `damecon-browser-*-x64.dmg` (Intel), open it and drag Damecon to Applications.

The build is signed ad-hoc but not notarized, so macOS blocks the first launch as coming from an unidentified developer. Open it once, then go to System Settings → Privacy & Security and click `Open Anyway` (on macOS 14 and older, right-clicking the app and choosing Open also works).

### Portable use (e.g. a USB drive)

Damecon can keep its data in a `damecon-data` folder beside the app, and the macOS and Windows builds can share it:

```
Damecon/
  damecon-browser.app/                ← macOS
  damecon-browser-win32-x64-<ver>/     ← Windows zip, extracted into its own folder
  damecon-data/                       ← created on first use, shared by both
```

In Settings → Damecon → Data, choose `Next to the app` and restart. From then on, either build uses `damecon-data` on any computer.

- Settings, KC3Kai data, the KCCP cache and mods travel with the folder. DMM logins are encrypted per computer, so you sign in again on each one.
- Don't run both builds on the same data at once.
- On macOS, an app copied from a download still carries the quarantine flag, and macOS runs it from a temporary copy that can't see `damecon-data`. Clear the flag once: `xattr -dr com.apple.quarantine /path/to/damecon-browser.app`.
- To update, replace the app or extract the new Windows zip beside the old one; `damecon-data` stays.

### From source code, using `yarn`:

Requires Node.js 22 (22.12 or later).

```bash
git clone https://github.com/yecl/damecon-browser
cd damecon-browser

yarn
yarn start
```

### 🔌 Install extensions

Unpacked extensions inside `./extensions` will be loaded automatically.

- Supports both Manifest V2 and V3 extensions.
- Some/many plugins may not run properly (or at all) due to various extension APIs being unsupported. Known gaps:
  - `chrome.proxy` (proxy switchers such as ZeroOmega); use Damecon's own proxy settings instead.
  - `webRequest.onAuthRequired`.
  - Extension pages inside DevTools (such as KC3's panel) and extension pages embedded in iframes only get Electron's built-in `chrome.*` APIs (no `tabs`, `windows`, `downloads`, ...).

There are a few plugins bundled with the Release builds for your convenience. It is safe to remove them if you wish (just delete from the `extensions` folder).

### ⚙️ Configure settings

On first launch, the settings page will open.

It will automatically begin downloading the latest Release version of KC3Kai, and upon completion, the KC3 start page will open.

You can access the Damecon settings again at any time by clicking the damecon icon at the top-left corner of the window.

### KC3Kai Update Configuration

The KC3Kai section in the settings page allows you to configure how KC3 is updated.

You can select from three different update channels: `release`, `master`, and `develop`.

- It is recommended to remain on the `release` channel, for the most stable experience.
- `master` and `develop` contain code actively in development, and may be unstable.
  - If using one of these two channels, the initial update may take several minutes to complete.
- Different channels are stored independently and have their own separate profiles.
  - You can switch between channels at any time, and those channels won't need to be re-downloaded.
  - Switching channels will automatically unload the old channel's extension and load the new one in.
  - To remove the files for a channel, simply delete the associated `kc3kai-*` folder within `./extensions`.

### Proxy

The `Proxy` page shows the route traffic takes and lets you set it up:

- **Proxy server**: turn on `Use a proxy`, pick HTTP or SOCKS5, enter host and port, then `Save`. Everything goes through it: websites, logins, KC3 updates, web store downloads and the built-in KCCP.
- **KCCacheProxy**: `Send game servers through KCCP` routes only `*.kancolle-server.com` to KCCP. Everything else keeps using the proxy directly.

`chrome.proxy` extensions such as ZeroOmega are not supported; use these settings instead.

### KCCacheProxy

[KCCacheProxy](https://github.com/Tibowl/KCCacheProxy) keeps game assets (ship art, voices, maps...) on disk and can apply asset mods. Set it up on the `KCCP` page. Damecon accepts KCCP's certificate for the game servers only, so nothing needs to be trusted in the system keychain.

- **Built-in** (default): Damecon runs KCCP itself on the address you choose. Its downloads from the game servers go through the proxy above. Its cache, mods and config live in `userdata/kccp`.
- **External**: use a KCCP you run yourself (enter its HTTPS/MITM port). It connects to the game servers on its own network. To proxy it, run it on a recent Node.js (e.g. its Docker image) with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY=http://host:port`, or use a system-wide/TUN proxy.

For the built-in KCCP, the page also shows its status and request/cache stats, a live log, and cache tools: preload the common assets, import a cache dump, verify, open the cache folder. KCCP only caches what goes through it, so assets already in the browser's cache don't show up until `Always ask KCCP for game assets` is on or the browser cache is cleared.

#### Asset mods

All three kinds need the built-in KCCP and are managed on the `KCCP` page's `Mods` tab.

- **KCCP mods**: install from git (a few are listed on the page), add a `.mod.json` from disk, or convert a poi mod. KCCP replaces only the parts of an image that match the mod's original, so they survive game updates that repack sprite sheets.
- **`.hack` files**: turn on `Use .hack files` and put `<name>.hack.<ext>` under the game path in the hack folder, e.g. `kcs2/resources/ship/full/0467_6223_qgrxbhuvtrbf.hack.png`. They replace the whole file and take priority over the cache and KCCP mods.
- **Ship `config.ini`**: `kcs/resources/swf/ships/<ship file name>.config.ini` in the hack folder, in the 岛风GO format (`[graph]` positions such as `boko_n_left`, `[info] ship_name`). Values replace the server's; empty keys keep them. They apply when the game starts. KC3 also sees a changed ship name.

Press `Reload` after adding or removing `.hack` or `config.ini` files.

## Features

### ✨ Showcase

Configurable KC3Kai autostart/update options:

![preview image showing KC3Kai configuration options.](./screenshots/update.png)

Themes:

![preview image showing theme options.](./screenshots/themes.png)

New Tab launch page:

![preview image showing new tab page.](./screenshots/newtab.png)

### 🚀 Current

- [x] macOS arm64 builds (DMG)
- [x] KC3Kai integration
- [x] Automatic updates for KC3
- [x] Support both release and in-development versions of KC3
- [x] Configurable KC3 update schedule (daily/weekly/always/never)
- [x] Auto-open KC3 start page (with developer tools) and strategy room
- [x] HTTP/SOCKS5 proxy support
- [x] Built-in or external KCCacheProxy, chained in front of the proxy for game servers
- [x] Asset mods: KCCP mods, `.hack` files and ship `config.ini`
- [x] Color and light/dark theme support
- [x] Manifest V3 extensions support
- [x] Chrome Webstore extensions support
- [x] New Tab page with links to common third-party KanColle resources
- [x] Configuration options for new tab behavior
  - Can select KC3 launch page, DMM game page, strategy room
- [x] Multiple window support
- [ ] Option to ask before installing KC3 updates
- [x] 'Custom' channel for managing your own KC3 folder location
- [x] Common keyboard shortcuts (F12, Ctrl+T, Ctrl+F4, Ctrl+Tab, Ctrl+D, etc)
- [x] Per-site address bar hiding with wildcard support
- [x] Common mouse gestures (Tab middle-click, draggable tabs, Ctrl+scroll, etc)
- [ ] Link hover URL tooltips
- [x] Find in page (Ctrl+F)
- [x] Mute tabs (tab context menu or the tab's speaker icon)

### 🤞 Eventually

- [ ] Extension management (enable/disable/uninstall)
- [ ] .CRX extension loader
- [ ] Support for more common [`chrome.*` extension APIs](https://developer.chrome.com/extensions/devguide)
- [ ] Respect extension manifest permissions
  - I must reiterate, this is _not_ a secure browser

### ❌ Not planned

- Detachable tabs
- Advanced general-use browser features from Chrome/Edge/etc
  - Including password manager and other security features
- AI integration of any kind (you're welcome)

## License

GPL-3

This project is based on the [electron-browser-shell](https://github.com/samuelmaddock/electron-browser-shell) project by Samuel Maddock.

The following notice has been retained from the original repository:

> For proprietary use [of electron-browser-shell], please [contact [samuelmaddock]](mailto:sam@samuelmaddock.com?subject=electron-browser-shell%20license) or [sponsor [samuelmaddock] on GitHub](https://github.com/sponsors/samuelmaddock/) under the appropriate tier to [acquire a proprietary-use license](https://github.com/samuelmaddock/electron-browser-shell/blob/master/LICENSE-PATRON.md). These contributions help make development and maintenance of this project more sustainable and show appreciation for the work thus far.

### Contributor license agreement

By sending a pull request, you hereby grant to owners and users of the
electron-browser-shell project a perpetual, worldwide, non-exclusive,
no-charge, royalty-free, irrevocable copyright license to reproduce, prepare
derivative works of, publicly display, publicly perform, sublicense, and
distribute your contributions and such derivative works.

The owners of the damecon-browser/electron-browser-shell projects will also be granted the right to relicense the
contributed source code and its derivative works.
