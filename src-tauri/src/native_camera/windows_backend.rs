use windows::Win32::Media::MediaFoundation::{
    MFIsVirtualCameraTypeSupported, MFVirtualCameraType_SoftwareCameraSource,
};

pub(crate) fn software_virtual_camera_type_supported() -> Result<bool, String> {
    let supported =
        unsafe { MFIsVirtualCameraTypeSupported(MFVirtualCameraType_SoftwareCameraSource) }
            .map_err(|error| {
                format!("Could not query Media Foundation virtual camera support: {error}")
            })?;

    Ok(supported.as_bool())
}
