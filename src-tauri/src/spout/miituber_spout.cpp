#include "miituber_spout.h"

#include "../../vendor/Spout2/SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.h"

#include <new>

namespace {
struct MiituberSpoutSender {
    spoutDX sender;
    unsigned width = 0;
    unsigned height = 0;
};
}

void* miituber_spout_create(const char* sender_name, unsigned width, unsigned height) {
    if (sender_name == nullptr || width == 0 || height == 0) {
        return nullptr;
    }

    auto* handle = new (std::nothrow) MiituberSpoutSender();
    if (handle == nullptr) {
        return nullptr;
    }

    if (!handle->sender.OpenDirectX11(nullptr)) {
        delete handle;
        return nullptr;
    }

    handle->sender.SetSenderFormat(DXGI_FORMAT_R8G8B8A8_UNORM);
    if (!handle->sender.SetSenderName(sender_name)) {
        handle->sender.ReleaseSender();
        delete handle;
        return nullptr;
    }

    handle->sender.HoldFps(30);
    handle->width = width;
    handle->height = height;
    return handle;
}

bool miituber_spout_send_rgba(void* raw_handle, const unsigned char* data, unsigned width, unsigned height) {
    if (raw_handle == nullptr || data == nullptr || width == 0 || height == 0) {
        return false;
    }

    auto* handle = static_cast<MiituberSpoutSender*>(raw_handle);
    handle->width = width;
    handle->height = height;
    return handle->sender.SendImage(data, width, height, width * 4);
}

void miituber_spout_destroy(void* raw_handle) {
    if (raw_handle == nullptr) {
        return;
    }

    auto* handle = static_cast<MiituberSpoutSender*>(raw_handle);
    handle->sender.ReleaseSender();
    handle->sender.CloseDirectX11();
    delete handle;
}
