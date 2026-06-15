#![cfg_attr(not(windows), allow(non_snake_case))]

use std::ffi::c_void;

pub const MIITUBER_CAMERA_SOURCE_CLSID: &str = "{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}";

const S_FALSE: i32 = 0x0000_0001;
const CLASS_E_CLASSNOTAVAILABLE: i32 = 0x8004_0111_u32 as i32;
const E_NOTIMPL: i32 = 0x8000_4001_u32 as i32;
const E_POINTER: i32 = 0x8000_4003_u32 as i32;

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    _class_id: *const c_void,
    _interface_id: *const c_void,
    class_factory: *mut *mut c_void,
) -> i32 {
    if class_factory.is_null() {
        return E_POINTER;
    }

    *class_factory = std::ptr::null_mut();
    CLASS_E_CLASSNOTAVAILABLE
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> i32 {
    S_FALSE
}

#[no_mangle]
pub extern "system" fn DllRegisterServer() -> i32 {
    E_NOTIMPL
}

#[no_mangle]
pub extern "system" fn DllUnregisterServer() -> i32 {
    E_NOTIMPL
}

#[cfg(test)]
mod tests {
    use super::{
        DllCanUnloadNow, DllGetClassObject, DllRegisterServer, DllUnregisterServer,
        CLASS_E_CLASSNOTAVAILABLE, E_NOTIMPL, E_POINTER, MIITUBER_CAMERA_SOURCE_CLSID, S_FALSE,
    };
    use std::ffi::c_void;

    #[test]
    fn source_clsid_matches_miituber_registration_identity() {
        assert_eq!(
            MIITUBER_CAMERA_SOURCE_CLSID,
            "{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}"
        );
    }

    #[test]
    fn class_factory_export_is_explicitly_unavailable_until_source_exists() {
        let mut class_factory: *mut c_void = std::ptr::dangling_mut();

        let result = unsafe {
            DllGetClassObject(
                std::ptr::null(),
                std::ptr::null(),
                &mut class_factory as *mut *mut c_void,
            )
        };

        assert_eq!(result, CLASS_E_CLASSNOTAVAILABLE);
        assert!(class_factory.is_null());
    }

    #[test]
    fn class_factory_export_rejects_null_output_pointer() {
        let result =
            unsafe { DllGetClassObject(std::ptr::null(), std::ptr::null(), std::ptr::null_mut()) };

        assert_eq!(result, E_POINTER);
    }

    #[test]
    fn registration_exports_are_not_enabled_before_source_implementation() {
        assert_eq!(DllRegisterServer(), E_NOTIMPL);
        assert_eq!(DllUnregisterServer(), E_NOTIMPL);
    }

    #[test]
    fn dll_stays_loaded_until_reference_tracking_exists() {
        assert_eq!(DllCanUnloadNow(), S_FALSE);
    }
}
