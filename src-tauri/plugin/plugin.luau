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

local toolbar = plugin:CreateToolbar("ISpooferMotion")
local syncButton = toolbar:CreateButton(
	"Sync to Desktop",
	"Toggle connection to the ISpooferMotion Desktop App",
	"rbxassetid://137844667859456"
)

syncButton.Click:Connect(function()
	if polling then
		polling = false
		BASE_URL = nil
		clearPairingState()
		syncButton:SetActive(false)
		print("[ISpooferMotion] Disconnected from Desktop App")
	else
		print("[ISpooferMotion] Starting connection to Desktop App...")
		syncButton:SetActive(true)
		startPolling()
	end
end)

plugin.Unloading:Connect(function()
	polling = false
	BASE_URL = nil
end)
