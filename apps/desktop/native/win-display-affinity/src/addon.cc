// win-display-affinity: a small Windows diagnostics module for RealtimeDocs.
//
// It reads and sets the display affinity of the application's OWN top-level windows through the
// documented Win32 functions GetWindowDisplayAffinity / SetWindowDisplayAffinity, and reports the
// desktop composition state (DwmIsCompositionEnabled) and waits for the next composition (DwmFlush).
//
// Exports exactly four functions and nothing else:
//   getDisplayAffinity(hwnd: Buffer)           -> { ok, affinity?, error?, win32Code? }
//   setDisplayAffinity(hwnd: Buffer, v: number) -> { ok, error?, win32Code? }
//   isCompositionEnabled()                      -> { ok, enabled?, error?, win32Code? }
//   flushComposition()                          -> { ok, error?, win32Code? }
//
// It does not hook, inject, patch or intercept anything, does not touch other processes or
// windows, installs no driver, changes no security setting and hides no process.
//
// Written against the raw Node-API C interface (node_api.h); no node-addon-api.
// NOT BUILT OR RUN on the machine where it was written (no Windows toolchain there).

#include <node_api.h>

#include <windows.h>
#include <dwmapi.h>

#include <cstdint>
#include <cstring>

// Defined by Windows SDK 10.0.19041 and later; older SDK headers lack it. The value is fixed by the
// documented ABI (winuser.h), and the OS rejects it with an error on Windows earlier than 10 version 2004.
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

namespace {

// ---- result helpers -------------------------------------------------------------------------

napi_value NewObject(napi_env env) {
  napi_value object = nullptr;
  if (napi_create_object(env, &object) != napi_ok) return nullptr;
  return object;
}

void SetBool(napi_env env, napi_value object, const char* name, bool value) {
  napi_value v = nullptr;
  if (napi_get_boolean(env, value, &v) == napi_ok) napi_set_named_property(env, object, name, v);
}

void SetUint32(napi_env env, napi_value object, const char* name, uint32_t value) {
  napi_value v = nullptr;
  if (napi_create_uint32(env, value, &v) == napi_ok) napi_set_named_property(env, object, name, v);
}

void SetString(napi_env env, napi_value object, const char* name, const char* value) {
  napi_value v = nullptr;
  if (napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &v) == napi_ok) {
    napi_set_named_property(env, object, name, v);
  }
}

// A refusal made by this module's own checks. `error` is a stable symbolic name.
napi_value Refuse(napi_env env, const char* code) {
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", false);
  SetString(env, result, "error", code);
  return result;
}

// A failure reported by Windows. `error` is "win32_error" and `win32Code` is GetLastError().
napi_value Win32Failure(napi_env env, DWORD code) {
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", false);
  SetString(env, result, "error", "win32_error");
  SetUint32(env, result, "win32Code", static_cast<uint32_t>(code));
  return result;
}

// ---- argument and window checks -------------------------------------------------------------

// Reads a Buffer of exactly sizeof(HWND) bytes. On failure `*code` names the reason and the
// function returns false.
bool ReadHwnd(napi_env env, napi_value value, HWND* out, const char** code) {
  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer) {
    *code = "invalid_argument";
    return false;
  }
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || data == nullptr) {
    *code = "invalid_argument";
    return false;
  }
  if (length != sizeof(HWND)) {
    *code = "invalid_handle_size";
    return false;
  }
  HWND handle = nullptr;
  std::memcpy(&handle, data, sizeof(HWND));
  *out = handle;
  return true;
}

// Every function that takes a window runs this first. Only this process's own top-level
// windows pass; anything else is refused untouched.
bool CheckOwnTopLevelWindow(HWND hwnd, const char** code) {
  if (hwnd == nullptr || !IsWindow(hwnd)) {
    *code = "not_a_window";
    return false;
  }
  DWORD owner_process = 0;
  const DWORD owner_thread = GetWindowThreadProcessId(hwnd, &owner_process);
  if (owner_thread == 0 || owner_process != GetCurrentProcessId()) {
    *code = "not_own_window";
    return false;
  }
  if (GetAncestor(hwnd, GA_ROOT) != hwnd) {
    *code = "not_top_level";
    return false;
  }
  return true;
}

// ---- exported functions ---------------------------------------------------------------------

napi_value GetDisplayAffinity(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) {
    return Refuse(env, "invalid_argument");
  }
  HWND hwnd = nullptr;
  const char* code = nullptr;
  if (!ReadHwnd(env, argv[0], &hwnd, &code) || !CheckOwnTopLevelWindow(hwnd, &code)) {
    return Refuse(env, code);
  }
  DWORD affinity = 0;
  SetLastError(ERROR_SUCCESS);
  if (!GetWindowDisplayAffinity(hwnd, &affinity)) return Win32Failure(env, GetLastError());
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", true);
  SetUint32(env, result, "affinity", static_cast<uint32_t>(affinity));
  return result;
}

napi_value SetDisplayAffinity(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2) {
    return Refuse(env, "invalid_argument");
  }
  // The value is validated before any window is looked at.
  double number = 0;
  if (napi_get_value_double(env, argv[1], &number) != napi_ok) return Refuse(env, "invalid_argument");
  if (!(number >= 0 && number <= 255)) return Refuse(env, "invalid_affinity");
  const DWORD wanted = static_cast<DWORD>(number);
  if (static_cast<double>(wanted) != number ||
      (wanted != WDA_NONE && wanted != WDA_MONITOR && wanted != WDA_EXCLUDEFROMCAPTURE)) {
    return Refuse(env, "invalid_affinity");
  }
  HWND hwnd = nullptr;
  const char* code = nullptr;
  if (!ReadHwnd(env, argv[0], &hwnd, &code) || !CheckOwnTopLevelWindow(hwnd, &code)) {
    return Refuse(env, code);
  }
  SetLastError(ERROR_SUCCESS);
  if (!SetWindowDisplayAffinity(hwnd, wanted)) return Win32Failure(env, GetLastError());
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", true);
  return result;
}

napi_value IsCompositionEnabled(napi_env env, napi_callback_info) {
  BOOL enabled = FALSE;
  const HRESULT hr = DwmIsCompositionEnabled(&enabled);
  if (FAILED(hr)) return Win32Failure(env, static_cast<DWORD>(hr));
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", true);
  SetBool(env, result, "enabled", enabled != FALSE);
  return result;
}

// Blocks the calling thread until the next desktop composition (about one display refresh).
napi_value FlushComposition(napi_env env, napi_callback_info) {
  const HRESULT hr = DwmFlush();
  if (FAILED(hr)) return Win32Failure(env, static_cast<DWORD>(hr));
  napi_value result = NewObject(env);
  if (result == nullptr) return nullptr;
  SetBool(env, result, "ok", true);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor properties[] = {
      {"getDisplayAffinity", nullptr, GetDisplayAffinity, nullptr, nullptr, nullptr, napi_enumerable,
       nullptr},
      {"setDisplayAffinity", nullptr, SetDisplayAffinity, nullptr, nullptr, nullptr, napi_enumerable,
       nullptr},
      {"isCompositionEnabled", nullptr, IsCompositionEnabled, nullptr, nullptr, nullptr,
       napi_enumerable, nullptr},
      {"flushComposition", nullptr, FlushComposition, nullptr, nullptr, nullptr, napi_enumerable,
       nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) !=
      napi_ok) {
    return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
