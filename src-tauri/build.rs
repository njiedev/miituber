fn main() {
    #[cfg(target_os = "windows")]
    build_spout_shim();

    tauri_build::build()
}

#[cfg(target_os = "windows")]
fn build_spout_shim() {
    let spout_root = "vendor/Spout2/SPOUTSDK";
    let spout_dx = "vendor/Spout2/SPOUTSDK/SpoutDirectX/SpoutDX";
    let spout_gl = "vendor/Spout2/SPOUTSDK/SpoutGL";

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .define("SPOUT_BUILD_STATIC", None)
        .include(spout_root)
        .include(spout_dx)
        .include(spout_gl)
        .file("src/spout/miituber_spout.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutCopy.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutDirectX.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutFrameCount.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutSenderNames.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutSharedMemory.cpp")
        .file("vendor/Spout2/SPOUTSDK/SpoutGL/SpoutUtils.cpp")
        .compile("miituber_spout");

    println!("cargo:rustc-link-lib=d3d11");
    println!("cargo:rustc-link-lib=dxgi");
    println!("cargo:rustc-link-lib=psapi");
    println!("cargo:rustc-link-lib=user32");
    println!("cargo:rustc-link-lib=gdi32");
    println!("cargo:rustc-link-lib=shell32");
}
