--!strict
local ASSET_PROPERTIES: { [string]: { string } } = {}
local STRING_SCAN_PROPERTIES: { [string]: { string } } = {}

--#include "src/config/runtime.luau"
--#include "src/types/assets.luau"
--#include "src/state/registry.luau"
--#include "src/util/assets.luau"
--#include "src/net/http.luau"
--#include "src/scan/properties.luau"
--#include "src/scan/scanner.luau"
--#include "src/patch/mesh.luau"
--#include "src/patch/patcher.luau"
--#include "src/bridge/discovery.luau"
--#include "src/bridge/polling.luau"

plugin.Unloading:Connect(function()
	polling = false
	BASE_URL = nil
end)

print("[ISpooferMotion] Auto-starting Studio bridge...")
startPolling()
