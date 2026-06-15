# MiiTuber Native Camera Source

This crate is the Windows COM DLL that `MFCreateVirtualCamera` will activate
through the source CLSID `{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}`.

The Tauri app owns output settings, frame capture, and the latest BGRA frame
snapshot. Windows does not load the Tauri app as the camera source. Instead,
Windows Camera Frame Server loads this DLL in its own process and asks it for a
Media Foundation source object.

Current state:

- Exports the standard COM DLL entry points:
  - `DllGetClassObject`
  - `DllCanUnloadNow`
  - `DllRegisterServer`
  - `DllUnregisterServer`
- Uses the same CLSID string as the Tauri registration path.
- Returns explicit "not implemented / class unavailable" HRESULTs until the
  `IMFMediaSource` and class factory exist.

Next implementation steps:

1. Implement a class factory for the source CLSID.
2. Implement an `IMFMediaSource` + `IMFMediaStream` pair that advertises BGRA /
   RGB32 frames at the active MiiTuber output resolution and FPS.
3. Add a shared-memory or named-pipe handoff from the Tauri app to this DLL so
   the source can read the latest BGRA snapshot when Frame Server requests a
   sample.
4. Make `DllRegisterServer` / `DllUnregisterServer` write and remove the CLSID
   registration only after the source can serve frames.
