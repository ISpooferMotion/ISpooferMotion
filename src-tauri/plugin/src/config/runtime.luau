local EMBEDDED_ASSET_PROPS: { [string]: boolean } = {
	Text = true,
	PlaceholderText = true,
	Image = true,
	HoverImage = true,
	PressedImage = true,
	ToolTip = true,
	Video = true,
	Name = true,
}

local AssetService = game:GetService("AssetService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local API_KEY_SETTING: string = "ISpooferMotion_API_Key"

local PORT_START: number = 14285
local PORT_END: number = 14289
local SEND_CHUNK_SIZE: number = 5000
local MAX_SCRIPT_SOURCE_BYTES: number = 8000000
local MAX_TAGS_PER_OBJECT: number = 100
local MAX_TAG_BYTES: number = 100
local MAX_PATCHES_PER_BATCH: number = 1000
local MAX_HTTP_BODY_BYTES: number = 10000000
local MAX_HTTP_RESPONSE_BYTES: number = 1000000
local BASE_URL: string? = nil
local API_KEY: string? = plugin:GetSetting(API_KEY_SETTING)

local polling: boolean = false
local scanRunning: boolean = false
local patchRunning: boolean = false
local lastDiscovery: number = 0

local SERVICES_TO_SCAN: { string } = {
	"Workspace",
	"Lighting",
	"MaterialService",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"SoundService",
	"Teams",
	"Chat",
	"LocalizationService",
	"TextChatService",
}
