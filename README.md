# MiiTuber

<img width="1280" height="310" alt="New Project (1)" src="https://github.com/user-attachments/assets/047e1588-3a1e-4478-ae4e-c9119f5ce943" />

Turn your **Mii** into a VTuber. MiiTuber shows your Mii as a live 3D avatar that copies your head movements from your webcam and moves its mouth when you talk, ready to drop into OBS with a transparent background.

Everything runs on your own PC. No accounts, no uploads, nothing sent anywhere.


## Download

**[⬇ Download the latest release](https://github.com/njiedev/miituber/releases/latest)** (Windows)

Download, run it, and follow the one-time setup below.

## One-time setup: the Mii resource file

Miis are rendered using Nintendo's official Mii models and textures, which come in a single file called `AFLResHigh_2_3.dat`. MiiTuber can't include this file for copyright reasons, so you grab it yourself. It takes about a minute:

1. **Download the file** from the Internet Archive (it's from Miitomo, Nintendo's old mobile app):
   <https://web.archive.org/web/20180502054513/http://download-cdn.miitomo.com/native/20180125111639/android/v2/asset_model_character_mii_AFLResHigh_2_3_dat.zip>
2. **Unzip it.** Inside is a file named `AFLResHigh_2_3.dat`.
3. **Open MiiTuber.** The first time it runs, it will ask you to locate this file. Point it at the one you just unzipped and you're done. You won't need it again.

> Already have this file from another Mii app (sometimes named `ffl_hires.dat`)? It's likely the same thing, so just select it when MiiTuber asks.

## Getting your Mii

MiiTuber comes with a sample Mii so you can try everything right away. To use *your* Mii, you need it as a small data file. Pick whichever applies to you:

- **Make one from scratch** with [Mii Creator](https://mii.nxw.pw), a free web Mii editor (joining [their Discord](https://discord.gg/miicreator) is required to use it). Build your Mii, then export it as an **FFSD (`.ffsd`) file**, the format MiiTuber reads. Don't use the `.miic` export; MiiTuber can't open those.
- **Had a Wii U or 3DS back in the day?** If you remember your Nintendo Network ID, [mii-unsecure.ariankordi.net](https://mii-unsecure.ariankordi.net) has an archive of those Miis. Type your NNID and click **Download .ffsd**. (It's a free community site, so it's occasionally down.)
- **Just want a ready-made Mii?** [MiiDataFiles](https://github.com/HEYimHeroic/MiiDataFiles) has thousands of Miis from the community Mii Library, downloadable as files MiiTuber can open.

Then import the file in MiiTuber and it's saved to your library.

<details>
<summary>All supported file types</summary>

- `.ffsd` / `.cfsd`: Wii U / 3DS Miis (the most common and best-supported format)
- `.mii`, `.miigx`, `.mae`, `.rcd`, `.rsd`: original Wii Miis
- Mii Studio data from Nintendo's [Mii Studio](https://studio.mii.nintendo.com) site
- Older `.miic` files from early Mii Creator versions (current `.miic` exports are **not** supported; export as `.ffsd` instead)

</details>

## Adding your Mii to OBS

1. In MiiTuber, turn on **transparent background**. The whole MiiTuber window becomes see-through except your Mii.
2. In OBS, add a **Window Capture** source and select the MiiTuber window.
3. Your Mii now floats over your scene. No green screen needed.

> **Don't minimize the window while streaming.** OBS can't capture a minimized window, so your Mii will disappear from your scene. It's fine if the window is hidden behind other windows or moved off to the side. Just keep it open, not minimized.

## Bugs & feedback

Found a bug or have a request? [Open an issue](https://github.com/njiedev/miituber/issues) or reach out on Twitter: [@3weeksbuilding](https://twitter.com/3weeksbuilding).

## Building from source

For developers. Regular users can ignore this. You'll need [Node.js](https://nodejs.org) 20+ and the [Rust toolchain](https://rustup.rs).

```powershell
git clone https://github.com/njiedev/miituber
cd miituber
npm install
# put AFLResHigh_2_3.dat (see above) in public/
npm run tauri dev
```

Architecture and contributor docs live in [docs/](docs/README.md).

## License & credits

MiiTuber is open source under **AGPL-3.0**, built on the work of the Mii research community:

- [FFL.js](https://github.com/ariankordi/FFL.js) and [FFL-Testing](https://github.com/ariankordi/FFL-Testing) by **Arian Kordi**
- The [FFL decompilation](https://github.com/aboood40091/ffl) by **AboodXD**
- [Mii Creator](https://mii.nxw.pw) by **kat21**
- [MiiDataFiles](https://github.com/HEYimHeroic/MiiDataFiles) by **HEYimHeroic**

MiiTuber is a fan project. It is not affiliated with, endorsed by, or sponsored by Nintendo. *Mii* is a trademark of Nintendo. No Nintendo assets are distributed with this software.
