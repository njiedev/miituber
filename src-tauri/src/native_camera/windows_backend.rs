use super::NativeCameraRegistrationDescriptor;
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

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct WindowsVirtualCameraRegistrationStrings {
    pub(crate) friendly_name_wide: Vec<u16>,
    pub(crate) source_id_wide: Vec<u16>,
}

impl WindowsVirtualCameraRegistrationStrings {
    pub(crate) fn from_descriptor(
        descriptor: &NativeCameraRegistrationDescriptor,
    ) -> Result<Self, String> {
        if descriptor.friendly_name.trim().is_empty() {
            return Err("Native camera friendly name cannot be empty".to_string());
        }
        if descriptor.source_id.trim().is_empty() {
            return Err("Native camera source id cannot be empty".to_string());
        }

        Ok(Self {
            friendly_name_wide: nul_terminated_utf16(descriptor.friendly_name),
            source_id_wide: nul_terminated_utf16(descriptor.source_id),
        })
    }
}

fn nul_terminated_utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{nul_terminated_utf16, WindowsVirtualCameraRegistrationStrings};
    use crate::native_camera::{
        native_camera_registration_descriptor, NativeCameraRegistrationDescriptor,
        NATIVE_CAMERA_DEVICE_NAME, NATIVE_CAMERA_SOURCE_ID,
    };

    #[test]
    fn converts_registration_descriptor_to_windows_strings() {
        let descriptor = native_camera_registration_descriptor();
        let strings = WindowsVirtualCameraRegistrationStrings::from_descriptor(&descriptor)
            .expect("descriptor should convert");

        assert_eq!(descriptor.friendly_name, NATIVE_CAMERA_DEVICE_NAME);
        assert_eq!(descriptor.source_id, NATIVE_CAMERA_SOURCE_ID);
        assert_eq!(
            strings.friendly_name_wide,
            nul_terminated_utf16(NATIVE_CAMERA_DEVICE_NAME)
        );
        assert_eq!(
            strings.source_id_wide,
            nul_terminated_utf16(NATIVE_CAMERA_SOURCE_ID)
        );
        assert_eq!(strings.friendly_name_wide.last(), Some(&0));
        assert_eq!(strings.source_id_wide.last(), Some(&0));
    }

    #[test]
    fn rejects_empty_registration_descriptor_strings() {
        let descriptor = NativeCameraRegistrationDescriptor {
            friendly_name: "",
            source_id: NATIVE_CAMERA_SOURCE_ID,
        };

        assert!(WindowsVirtualCameraRegistrationStrings::from_descriptor(&descriptor).is_err());

        let descriptor = NativeCameraRegistrationDescriptor {
            friendly_name: NATIVE_CAMERA_DEVICE_NAME,
            source_id: " ",
        };

        assert!(WindowsVirtualCameraRegistrationStrings::from_descriptor(&descriptor).is_err());
    }
}
