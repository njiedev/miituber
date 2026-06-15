use super::NativeCameraRegistrationDescriptor;
use windows::core::PCWSTR;
use windows::Win32::Media::MediaFoundation::{
    IMFVirtualCamera, MFCreateVirtualCamera, MFIsVirtualCameraTypeSupported,
    MFVirtualCameraAccess_CurrentUser, MFVirtualCameraLifetime_Session,
    MFVirtualCameraType_SoftwareCameraSource,
};

pub(crate) fn software_virtual_camera_type_supported() -> Result<bool, String> {
    let supported =
        unsafe { MFIsVirtualCameraTypeSupported(MFVirtualCameraType_SoftwareCameraSource) }
            .map_err(|error| {
                format!("Could not query Media Foundation virtual camera support: {error}")
            })?;

    Ok(supported.as_bool())
}

#[allow(dead_code)]
pub(crate) fn create_and_remove_session_virtual_camera(
    descriptor: &NativeCameraRegistrationDescriptor,
) -> Result<(), String> {
    let registration = WindowsVirtualCameraRegistration::create_session(descriptor)?;
    registration.remove()
}

#[allow(dead_code)]
pub(crate) struct WindowsVirtualCameraRegistration {
    camera: IMFVirtualCamera,
}

impl WindowsVirtualCameraRegistration {
    #[allow(dead_code)]
    pub(crate) fn create_session(
        descriptor: &NativeCameraRegistrationDescriptor,
    ) -> Result<Self, String> {
        let strings = WindowsVirtualCameraRegistrationStrings::from_descriptor(descriptor)?;
        let camera = unsafe {
            MFCreateVirtualCamera(
                MFVirtualCameraType_SoftwareCameraSource,
                MFVirtualCameraLifetime_Session,
                MFVirtualCameraAccess_CurrentUser,
                PCWSTR(strings.friendly_name_wide.as_ptr()),
                PCWSTR(strings.source_id_wide.as_ptr()),
                None,
            )
        }
        .map_err(|error| format!("Could not create Media Foundation virtual camera: {error}"))?;

        Ok(Self { camera })
    }

    #[allow(dead_code)]
    pub(crate) fn remove(self) -> Result<(), String> {
        unsafe { self.camera.Remove() }
            .map_err(|error| format!("Could not remove Media Foundation virtual camera: {error}"))
    }
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
        if !is_braced_clsid_string(descriptor.source_id) {
            return Err(
                "Native camera source id must be a COM CLSID string like {00000000-0000-0000-0000-000000000000}"
                    .to_string(),
            );
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

fn is_braced_clsid_string(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 38 || bytes.first() != Some(&b'{') || bytes.last() != Some(&b'}') {
        return false;
    }

    bytes.iter().enumerate().all(|(index, byte)| {
        matches!(index, 0 | 37)
            || (matches!(index, 9 | 14 | 19 | 24) && *byte == b'-')
            || (!matches!(index, 9 | 14 | 19 | 24) && byte.is_ascii_hexdigit())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        create_and_remove_session_virtual_camera, is_braced_clsid_string, nul_terminated_utf16,
        software_virtual_camera_type_supported, WindowsVirtualCameraRegistrationStrings,
    };
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

    #[test]
    fn rejects_non_clsid_source_id() {
        let descriptor = NativeCameraRegistrationDescriptor {
            friendly_name: NATIVE_CAMERA_DEVICE_NAME,
            source_id: "miituber.native-camera.source",
        };

        assert!(WindowsVirtualCameraRegistrationStrings::from_descriptor(&descriptor).is_err());
    }

    #[test]
    fn validates_braced_clsid_source_id_shape() {
        assert!(is_braced_clsid_string(NATIVE_CAMERA_SOURCE_ID));
        assert!(is_braced_clsid_string(
            "{00000000-0000-0000-0000-000000000000}"
        ));
        assert!(!is_braced_clsid_string(
            "00000000-0000-0000-0000-000000000000"
        ));
        assert!(!is_braced_clsid_string(
            "{00000000-0000-0000-0000-00000000000Z}"
        ));
    }

    #[test]
    #[ignore = "creates and removes a Windows session virtual camera"]
    fn creates_and_removes_session_virtual_camera() {
        if !software_virtual_camera_type_supported().unwrap_or(false) {
            return;
        }

        create_and_remove_session_virtual_camera(&native_camera_registration_descriptor())
            .expect("session virtual camera should create and remove cleanly");
    }
}
