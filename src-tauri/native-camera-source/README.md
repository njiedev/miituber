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
- `DllGetClassObject` returns an `IClassFactory` for the MiiTuber source CLSID.
- The class factory returns a first `IMFMediaSource` COM object skeleton.
- The media source object supports `IUnknown`, `IMFMediaEventGenerator`, and
  `IMFMediaSource`, but its source/event methods still return `E_NOTIMPL` until
  descriptors, streams, and frame delivery exist.
- The source object carries the first default video format contract:
  stream id `1`, 1280x720, 30 fps, RGB32/BGRA-sized frames, 5120-byte stride,
  3,686,400 bytes per frame, and 333,333 100ns units per sample.
- Registration exports still return `E_NOTIMPL` so the DLL is not registered as
  a usable camera source before it can serve frames.

Next implementation steps:

1. Implement a presentation descriptor and media stream that advertise BGRA /
   RGB32 frames at the active MiiTuber output resolution and FPS.
2. Add a shared-memory or named-pipe handoff from the Tauri app to this DLL so
   the source can read the latest BGRA snapshot when Frame Server requests a
   sample.
3. Make `DllRegisterServer` / `DllUnregisterServer` write and remove the CLSID
   registration only after the source can serve frames.
