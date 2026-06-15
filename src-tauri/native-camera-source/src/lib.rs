#![cfg_attr(not(windows), allow(non_snake_case))]

use std::{
    ffi::c_void,
    ptr,
    sync::atomic::{AtomicU32, Ordering},
};

pub const MIITUBER_CAMERA_SOURCE_CLSID: &str = "{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}";

const S_OK: i32 = 0x0000_0000;
const S_FALSE: i32 = 0x0000_0001;
const CLASS_E_CLASSNOTAVAILABLE: i32 = 0x8004_0111_u32 as i32;
const CLASS_E_NOAGGREGATION: i32 = 0x8004_0110_u32 as i32;
const E_NOINTERFACE: i32 = 0x8000_4002_u32 as i32;
const E_NOTIMPL: i32 = 0x8000_4001_u32 as i32;
const E_POINTER: i32 = 0x8000_4003_u32 as i32;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const IID_IUNKNOWN: Guid = Guid {
    data1: 0x0000_0000,
    data2: 0x0000,
    data3: 0x0000,
    data4: [0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
};

const IID_ICLASS_FACTORY: Guid = Guid {
    data1: 0x0000_0001,
    data2: 0x0000,
    data3: 0x0000,
    data4: [0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46],
};

const IID_IMF_MEDIA_EVENT_GENERATOR: Guid = Guid {
    data1: 0x2cd0_bd52,
    data2: 0xbcd5,
    data3: 0x4b89,
    data4: [0xb6, 0x2c, 0xea, 0xdc, 0x0c, 0x03, 0x1e, 0x7d],
};

const IID_IMF_MEDIA_SOURCE: Guid = Guid {
    data1: 0x279a_808d,
    data2: 0xaec7,
    data3: 0x40c8,
    data4: [0x9c, 0x6b, 0xa6, 0xb4, 0x92, 0xc7, 0x8a, 0x66],
};

const CLSID_MIITUBER_CAMERA_SOURCE: Guid = Guid {
    data1: 0x8f9f_43f5,
    data2: 0x5b8c,
    data3: 0x4c4b,
    data4: [0xa8, 0xa9, 0x26, 0xb4, 0xe5, 0x8d, 0x2f, 0x8b],
};

#[repr(C)]
struct ClassFactory {
    vtable: &'static ClassFactoryVTable,
    refs: AtomicU32,
}

#[repr(C)]
struct ClassFactoryVTable {
    query_interface: unsafe extern "system" fn(
        this: *mut ClassFactory,
        interface_id: *const Guid,
        object: *mut *mut c_void,
    ) -> i32,
    add_ref: unsafe extern "system" fn(this: *mut ClassFactory) -> u32,
    release: unsafe extern "system" fn(this: *mut ClassFactory) -> u32,
    create_instance: unsafe extern "system" fn(
        this: *mut ClassFactory,
        outer: *mut c_void,
        interface_id: *const Guid,
        object: *mut *mut c_void,
    ) -> i32,
    lock_server: unsafe extern "system" fn(this: *mut ClassFactory, lock: bool) -> i32,
}

#[repr(C)]
struct MediaSource {
    vtable: &'static MediaSourceVTable,
    refs: AtomicU32,
}

#[repr(C)]
struct MediaSourceVTable {
    query_interface: unsafe extern "system" fn(
        this: *mut MediaSource,
        interface_id: *const Guid,
        object: *mut *mut c_void,
    ) -> i32,
    add_ref: unsafe extern "system" fn(this: *mut MediaSource) -> u32,
    release: unsafe extern "system" fn(this: *mut MediaSource) -> u32,
    get_event: unsafe extern "system" fn(
        this: *mut MediaSource,
        flags: u32,
        event: *mut *mut c_void,
    ) -> i32,
    begin_get_event: unsafe extern "system" fn(
        this: *mut MediaSource,
        callback: *mut c_void,
        state: *mut c_void,
    ) -> i32,
    end_get_event: unsafe extern "system" fn(
        this: *mut MediaSource,
        result: *mut c_void,
        event: *mut *mut c_void,
    ) -> i32,
    queue_event: unsafe extern "system" fn(
        this: *mut MediaSource,
        event_type: u32,
        extended_type: *const Guid,
        status: i32,
        value: *const c_void,
    ) -> i32,
    get_characteristics:
        unsafe extern "system" fn(this: *mut MediaSource, characteristics: *mut u32) -> i32,
    create_presentation_descriptor:
        unsafe extern "system" fn(this: *mut MediaSource, descriptor: *mut *mut c_void) -> i32,
    start: unsafe extern "system" fn(
        this: *mut MediaSource,
        presentation_descriptor: *mut c_void,
        time_format: *const Guid,
        start_position: *const c_void,
    ) -> i32,
    stop: unsafe extern "system" fn(this: *mut MediaSource) -> i32,
    pause: unsafe extern "system" fn(this: *mut MediaSource) -> i32,
    shutdown: unsafe extern "system" fn(this: *mut MediaSource) -> i32,
}

static ACTIVE_COM_OBJECTS: AtomicU32 = AtomicU32::new(0);
static SERVER_LOCKS: AtomicU32 = AtomicU32::new(0);

static CLASS_FACTORY_VTABLE: ClassFactoryVTable = ClassFactoryVTable {
    query_interface: class_factory_query_interface,
    add_ref: class_factory_add_ref,
    release: class_factory_release,
    create_instance: class_factory_create_instance,
    lock_server: class_factory_lock_server,
};

static MEDIA_SOURCE_VTABLE: MediaSourceVTable = MediaSourceVTable {
    query_interface: media_source_query_interface,
    add_ref: media_source_add_ref,
    release: media_source_release,
    get_event: media_source_get_event,
    begin_get_event: media_source_begin_get_event,
    end_get_event: media_source_end_get_event,
    queue_event: media_source_queue_event,
    get_characteristics: media_source_get_characteristics,
    create_presentation_descriptor: media_source_create_presentation_descriptor,
    start: media_source_start,
    stop: media_source_stop,
    pause: media_source_pause,
    shutdown: media_source_shutdown,
};

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    class_id: *const Guid,
    interface_id: *const Guid,
    class_factory: *mut *mut c_void,
) -> i32 {
    if class_factory.is_null() {
        return E_POINTER;
    }
    *class_factory = ptr::null_mut();

    if class_id.is_null() || interface_id.is_null() {
        return E_POINTER;
    }

    if *class_id != CLSID_MIITUBER_CAMERA_SOURCE {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    if !is_class_factory_interface(*interface_id) {
        return E_NOINTERFACE;
    }

    let factory = Box::new(ClassFactory {
        vtable: &CLASS_FACTORY_VTABLE,
        refs: AtomicU32::new(1),
    });
    ACTIVE_COM_OBJECTS.fetch_add(1, Ordering::SeqCst);
    *class_factory = Box::into_raw(factory).cast::<c_void>();
    S_OK
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> i32 {
    if ACTIVE_COM_OBJECTS.load(Ordering::SeqCst) == 0 && SERVER_LOCKS.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

#[no_mangle]
pub extern "system" fn DllRegisterServer() -> i32 {
    E_NOTIMPL
}

#[no_mangle]
pub extern "system" fn DllUnregisterServer() -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn class_factory_query_interface(
    this: *mut ClassFactory,
    interface_id: *const Guid,
    object: *mut *mut c_void,
) -> i32 {
    if this.is_null() || interface_id.is_null() || object.is_null() {
        return E_POINTER;
    }
    *object = ptr::null_mut();

    if !is_class_factory_interface(*interface_id) {
        return E_NOINTERFACE;
    }

    class_factory_add_ref(this);
    *object = this.cast::<c_void>();
    S_OK
}

unsafe extern "system" fn class_factory_add_ref(this: *mut ClassFactory) -> u32 {
    if this.is_null() {
        return 0;
    }

    (*this).refs.fetch_add(1, Ordering::SeqCst) + 1
}

unsafe extern "system" fn class_factory_release(this: *mut ClassFactory) -> u32 {
    if this.is_null() {
        return 0;
    }

    let refs = (*this).refs.fetch_sub(1, Ordering::SeqCst) - 1;
    if refs == 0 {
        ACTIVE_COM_OBJECTS.fetch_sub(1, Ordering::SeqCst);
        drop(Box::from_raw(this));
    }

    refs
}

unsafe extern "system" fn class_factory_create_instance(
    _this: *mut ClassFactory,
    outer: *mut c_void,
    interface_id: *const Guid,
    object: *mut *mut c_void,
) -> i32 {
    if object.is_null() {
        return E_POINTER;
    }
    *object = ptr::null_mut();

    if !outer.is_null() {
        return CLASS_E_NOAGGREGATION;
    }
    if interface_id.is_null() {
        return E_POINTER;
    }
    if !is_media_source_interface(unsafe { *interface_id }) {
        return E_NOINTERFACE;
    }

    let source = Box::new(MediaSource {
        vtable: &MEDIA_SOURCE_VTABLE,
        refs: AtomicU32::new(1),
    });
    ACTIVE_COM_OBJECTS.fetch_add(1, Ordering::SeqCst);
    *object = Box::into_raw(source).cast::<c_void>();
    S_OK
}

unsafe extern "system" fn class_factory_lock_server(_this: *mut ClassFactory, lock: bool) -> i32 {
    if lock {
        SERVER_LOCKS.fetch_add(1, Ordering::SeqCst);
    } else {
        let _ = SERVER_LOCKS.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |locks| {
            locks.checked_sub(1)
        });
    }

    S_OK
}

fn is_class_factory_interface(interface_id: Guid) -> bool {
    interface_id == IID_IUNKNOWN || interface_id == IID_ICLASS_FACTORY
}

unsafe extern "system" fn media_source_query_interface(
    this: *mut MediaSource,
    interface_id: *const Guid,
    object: *mut *mut c_void,
) -> i32 {
    if this.is_null() || interface_id.is_null() || object.is_null() {
        return E_POINTER;
    }
    *object = ptr::null_mut();

    if !is_media_source_interface(*interface_id) {
        return E_NOINTERFACE;
    }

    media_source_add_ref(this);
    *object = this.cast::<c_void>();
    S_OK
}

unsafe extern "system" fn media_source_add_ref(this: *mut MediaSource) -> u32 {
    if this.is_null() {
        return 0;
    }

    (*this).refs.fetch_add(1, Ordering::SeqCst) + 1
}

unsafe extern "system" fn media_source_release(this: *mut MediaSource) -> u32 {
    if this.is_null() {
        return 0;
    }

    let refs = (*this).refs.fetch_sub(1, Ordering::SeqCst) - 1;
    if refs == 0 {
        ACTIVE_COM_OBJECTS.fetch_sub(1, Ordering::SeqCst);
        drop(Box::from_raw(this));
    }

    refs
}

unsafe extern "system" fn media_source_get_event(
    _this: *mut MediaSource,
    _flags: u32,
    event: *mut *mut c_void,
) -> i32 {
    if event.is_null() {
        return E_POINTER;
    }

    *event = ptr::null_mut();
    E_NOTIMPL
}

unsafe extern "system" fn media_source_begin_get_event(
    _this: *mut MediaSource,
    _callback: *mut c_void,
    _state: *mut c_void,
) -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn media_source_end_get_event(
    _this: *mut MediaSource,
    _result: *mut c_void,
    event: *mut *mut c_void,
) -> i32 {
    if event.is_null() {
        return E_POINTER;
    }

    *event = ptr::null_mut();
    E_NOTIMPL
}

unsafe extern "system" fn media_source_queue_event(
    _this: *mut MediaSource,
    _event_type: u32,
    _extended_type: *const Guid,
    _status: i32,
    _value: *const c_void,
) -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn media_source_get_characteristics(
    _this: *mut MediaSource,
    characteristics: *mut u32,
) -> i32 {
    if characteristics.is_null() {
        return E_POINTER;
    }

    *characteristics = 0;
    E_NOTIMPL
}

unsafe extern "system" fn media_source_create_presentation_descriptor(
    _this: *mut MediaSource,
    descriptor: *mut *mut c_void,
) -> i32 {
    if descriptor.is_null() {
        return E_POINTER;
    }

    *descriptor = ptr::null_mut();
    E_NOTIMPL
}

unsafe extern "system" fn media_source_start(
    _this: *mut MediaSource,
    _presentation_descriptor: *mut c_void,
    _time_format: *const Guid,
    _start_position: *const c_void,
) -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn media_source_stop(_this: *mut MediaSource) -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn media_source_pause(_this: *mut MediaSource) -> i32 {
    E_NOTIMPL
}

unsafe extern "system" fn media_source_shutdown(_this: *mut MediaSource) -> i32 {
    E_NOTIMPL
}

fn is_media_source_interface(interface_id: Guid) -> bool {
    interface_id == IID_IUNKNOWN
        || interface_id == IID_IMF_MEDIA_EVENT_GENERATOR
        || interface_id == IID_IMF_MEDIA_SOURCE
}

#[cfg(test)]
mod tests {
    use super::{
        ClassFactory, DllCanUnloadNow, DllGetClassObject, DllRegisterServer, DllUnregisterServer,
        Guid, MediaSource, CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION,
        CLSID_MIITUBER_CAMERA_SOURCE, E_NOINTERFACE, E_NOTIMPL, E_POINTER, IID_ICLASS_FACTORY,
        IID_IMF_MEDIA_EVENT_GENERATOR, IID_IMF_MEDIA_SOURCE, IID_IUNKNOWN,
        MIITUBER_CAMERA_SOURCE_CLSID, S_FALSE, S_OK,
    };
    use std::ffi::c_void;

    const IID_UNSUPPORTED: Guid = Guid {
        data1: 0x1111_1111,
        data2: 0x2222,
        data3: 0x3333,
        data4: [0x44, 0x44, 0x55, 0x55, 0x66, 0x66, 0x77, 0x77],
    };

    #[test]
    fn source_clsid_matches_miituber_registration_identity() {
        assert_eq!(
            MIITUBER_CAMERA_SOURCE_CLSID,
            "{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}"
        );
        assert_eq!(CLSID_MIITUBER_CAMERA_SOURCE.data1, 0x8f9f_43f5);
        assert_eq!(CLSID_MIITUBER_CAMERA_SOURCE.data2, 0x5b8c);
        assert_eq!(CLSID_MIITUBER_CAMERA_SOURCE.data3, 0x4c4b);
    }

    #[test]
    fn class_factory_export_returns_factory_for_miituber_source_clsid() {
        let mut class_factory: *mut c_void = std::ptr::null_mut();

        let result = unsafe {
            DllGetClassObject(
                &CLSID_MIITUBER_CAMERA_SOURCE,
                &IID_ICLASS_FACTORY,
                &mut class_factory,
            )
        };

        assert_eq!(result, S_OK);
        assert!(!class_factory.is_null());
        unsafe {
            release_factory(class_factory);
        }
    }

    #[test]
    fn class_factory_export_supports_iunknown_request() {
        let mut class_factory: *mut c_void = std::ptr::null_mut();

        let result = unsafe {
            DllGetClassObject(
                &CLSID_MIITUBER_CAMERA_SOURCE,
                &IID_IUNKNOWN,
                &mut class_factory,
            )
        };

        assert_eq!(result, S_OK);
        assert!(!class_factory.is_null());
        unsafe {
            release_factory(class_factory);
        }
    }

    #[test]
    fn class_factory_export_rejects_unknown_clsid() {
        let mut class_factory: *mut c_void = std::ptr::dangling_mut();

        let result =
            unsafe { DllGetClassObject(&IID_UNSUPPORTED, &IID_ICLASS_FACTORY, &mut class_factory) };

        assert_eq!(result, CLASS_E_CLASSNOTAVAILABLE);
        assert!(class_factory.is_null());
    }

    #[test]
    fn class_factory_export_rejects_unsupported_interface() {
        let mut class_factory: *mut c_void = std::ptr::dangling_mut();

        let result = unsafe {
            DllGetClassObject(
                &CLSID_MIITUBER_CAMERA_SOURCE,
                &IID_UNSUPPORTED,
                &mut class_factory,
            )
        };

        assert_eq!(result, E_NOINTERFACE);
        assert!(class_factory.is_null());
    }

    #[test]
    fn class_factory_export_rejects_null_output_pointer() {
        let result = unsafe {
            DllGetClassObject(
                &CLSID_MIITUBER_CAMERA_SOURCE,
                &IID_ICLASS_FACTORY,
                std::ptr::null_mut(),
            )
        };

        assert_eq!(result, E_POINTER);
    }

    #[test]
    fn class_factory_create_instance_returns_media_source() {
        let class_factory = create_factory();
        let factory = class_factory.cast::<ClassFactory>();
        let mut source: *mut c_void = std::ptr::dangling_mut();

        let result = unsafe {
            ((*(*factory).vtable).create_instance)(
                factory,
                std::ptr::null_mut(),
                &IID_IMF_MEDIA_SOURCE,
                &mut source,
            )
        };

        assert_eq!(result, S_OK);
        assert!(!source.is_null());
        unsafe {
            release_media_source(source);
            release_factory(class_factory);
        }
    }

    #[test]
    fn class_factory_create_instance_rejects_aggregation_and_unknown_interface() {
        let class_factory = create_factory();
        let factory = class_factory.cast::<ClassFactory>();
        let mut source: *mut c_void = std::ptr::dangling_mut();
        let outer = std::ptr::dangling_mut();

        let aggregation_result = unsafe {
            ((*(*factory).vtable).create_instance)(factory, outer, &IID_IUNKNOWN, &mut source)
        };

        assert_eq!(aggregation_result, CLASS_E_NOAGGREGATION);
        assert!(source.is_null());

        let interface_result = unsafe {
            ((*(*factory).vtable).create_instance)(
                factory,
                std::ptr::null_mut(),
                &IID_UNSUPPORTED,
                &mut source,
            )
        };

        assert_eq!(interface_result, E_NOINTERFACE);
        assert!(source.is_null());
        unsafe {
            release_factory(class_factory);
        }
    }

    #[test]
    fn media_source_query_interface_supports_source_hierarchy() {
        let source = create_media_source();
        let media_source = source.cast::<MediaSource>();
        let mut queried: *mut c_void = std::ptr::null_mut();

        let result = unsafe {
            ((*(*media_source).vtable).query_interface)(
                media_source,
                &IID_IMF_MEDIA_EVENT_GENERATOR,
                &mut queried,
            )
        };

        assert_eq!(result, S_OK);
        assert_eq!(queried, source);
        unsafe {
            assert_eq!(((*(*media_source).vtable).release)(media_source), 1);
            assert_eq!(((*(*media_source).vtable).release)(media_source), 0);
        }
    }

    #[test]
    fn media_source_methods_are_stubbed_until_descriptors_and_streams_exist() {
        let source = create_media_source();
        let media_source = source.cast::<MediaSource>();
        let mut characteristics = u32::MAX;
        let mut descriptor: *mut c_void = std::ptr::dangling_mut();
        let mut event: *mut c_void = std::ptr::dangling_mut();

        unsafe {
            assert_eq!(
                ((*(*media_source).vtable).get_characteristics)(media_source, &mut characteristics),
                E_NOTIMPL
            );
            assert_eq!(characteristics, 0);
            assert_eq!(
                ((*(*media_source).vtable).create_presentation_descriptor)(
                    media_source,
                    &mut descriptor
                ),
                E_NOTIMPL
            );
            assert!(descriptor.is_null());
            assert_eq!(
                ((*(*media_source).vtable).get_event)(media_source, 0, &mut event),
                E_NOTIMPL
            );
            assert!(event.is_null());
            assert_eq!(
                ((*(*media_source).vtable).start)(
                    media_source,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                ),
                E_NOTIMPL
            );
            assert_eq!(((*(*media_source).vtable).stop)(media_source), E_NOTIMPL);
            assert_eq!(((*(*media_source).vtable).pause)(media_source), E_NOTIMPL);
            assert_eq!(
                ((*(*media_source).vtable).shutdown)(media_source),
                E_NOTIMPL
            );
            release_media_source(source);
        }
    }

    #[test]
    fn query_interface_adds_a_reference_for_supported_interfaces() {
        let class_factory = create_factory();
        let factory = class_factory.cast::<ClassFactory>();
        let mut queried: *mut c_void = std::ptr::null_mut();

        let result =
            unsafe { ((*(*factory).vtable).query_interface)(factory, &IID_IUNKNOWN, &mut queried) };

        assert_eq!(result, S_OK);
        assert_eq!(queried, class_factory);
        unsafe {
            assert_eq!(((*(*factory).vtable).release)(factory), 1);
            assert_eq!(((*(*factory).vtable).release)(factory), 0);
        }
    }

    #[test]
    fn dll_unload_reflects_factory_lifetime_and_locks() {
        assert_eq!(DllCanUnloadNow(), S_OK);
        let class_factory = create_factory();
        assert_eq!(DllCanUnloadNow(), S_FALSE);

        let factory = class_factory.cast::<ClassFactory>();
        unsafe {
            assert_eq!(((*(*factory).vtable).lock_server)(factory, true), S_OK);
        }
        assert_eq!(DllCanUnloadNow(), S_FALSE);

        unsafe {
            assert_eq!(((*(*factory).vtable).lock_server)(factory, false), S_OK);
        }
        assert_eq!(DllCanUnloadNow(), S_FALSE);

        unsafe {
            assert_eq!(((*(*factory).vtable).release)(factory), 0);
        }
        assert_eq!(DllCanUnloadNow(), S_OK);
    }

    #[test]
    fn registration_exports_are_not_enabled_before_source_implementation() {
        assert_eq!(DllRegisterServer(), E_NOTIMPL);
        assert_eq!(DllUnregisterServer(), E_NOTIMPL);
    }

    fn create_factory() -> *mut c_void {
        let mut class_factory: *mut c_void = std::ptr::null_mut();

        let result = unsafe {
            DllGetClassObject(
                &CLSID_MIITUBER_CAMERA_SOURCE,
                &IID_ICLASS_FACTORY,
                &mut class_factory,
            )
        };

        assert_eq!(result, S_OK);
        assert!(!class_factory.is_null());
        class_factory
    }

    unsafe fn release_factory(class_factory: *mut c_void) {
        let factory = class_factory.cast::<ClassFactory>();
        ((*(*factory).vtable).release)(factory);
    }

    fn create_media_source() -> *mut c_void {
        let class_factory = create_factory();
        let factory = class_factory.cast::<ClassFactory>();
        let mut source: *mut c_void = std::ptr::null_mut();

        let result = unsafe {
            ((*(*factory).vtable).create_instance)(
                factory,
                std::ptr::null_mut(),
                &IID_IMF_MEDIA_SOURCE,
                &mut source,
            )
        };

        assert_eq!(result, S_OK);
        assert!(!source.is_null());
        unsafe {
            release_factory(class_factory);
        }
        source
    }

    unsafe fn release_media_source(source: *mut c_void) {
        let media_source = source.cast::<MediaSource>();
        ((*(*media_source).vtable).release)(media_source);
    }
}
