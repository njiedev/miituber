#pragma once

#ifdef __cplusplus
extern "C" {
#endif

void* miituber_spout_create(const char* sender_name, unsigned width, unsigned height);
bool miituber_spout_send_rgba(void* handle, const unsigned char* data, unsigned width, unsigned height);
void miituber_spout_destroy(void* handle);

#ifdef __cplusplus
}
#endif
