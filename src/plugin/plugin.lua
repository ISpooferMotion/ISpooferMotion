local HttpService = game:GetService("HttpService")
local CollectionService = game:GetService("CollectionService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local PLUGIN_VERSION = "__ISPOOFERMOTION_VERSION__"
if PLUGIN_VERSION:match("^__") then
	PLUGIN_VERSION = "dev"
end

local PORT = 3100
local MAX_PORT = 3110
local BASE_URLS = {}
for port = PORT, MAX_PORT do
	table.insert(BASE_URLS, "http://localhost:" .. tostring(port))
	table.insert(BASE_URLS, "http://127.0.0.1:" .. tostring(port))
end
local ICON_ID = "rbxassetid://11778372908"

local KNOWN_ASSET_PROPERTIES = {
	Animation = { "AnimationId" },
	Sound = { "SoundId" },
	AudioPlayer = { "Asset", "AssetId" },
	Decal = { "Texture" },
	Texture = { "Texture" },
	ImageLabel = { "Image" },
	ImageButton = { "Image", "HoverImage", "PressedImage" },
	MeshPart = { "MeshId", "TextureID" },
	SpecialMesh = { "MeshId", "TextureId" },
	Shirt = { "ShirtTemplate" },
	Pants = { "PantsTemplate" },
	ShirtGraphic = { "Graphic" },
	SurfaceAppearance = { "ColorMap", "MetalnessMap", "NormalMap", "RoughnessMap" },
	VideoFrame = { "Video" },
	ParticleEmitter = { "Texture" },
	Beam = { "Texture" },
	Trail = { "Texture" },
	Sky = { "SkyboxBk", "SkyboxDn", "SkyboxFt", "SkyboxLf", "SkyboxRt", "SkyboxUp" },
}

local HUMANOID_DESCRIPTION_ANIMATION_PROPERTIES = {
	"ClimbAnimation",
	"FallAnimation",
	"IdleAnimation",
	"JumpAnimation",
	"MoodAnimation",
	"RunAnimation",
	"SwimAnimation",
	"WalkAnimation",
}

local IGNORED_ROOTS = {
	CoreGui = true,
	CorePackages = true,
	PluginGuiService = true,
	RobloxPluginGuiService = true,
	RobloxReplicatedStorage = true,
	StudioData = true,
	StudioService = true,
	ChangeHistoryService = true,
	DebuggerManager = true,
	PluginDebugService = true,
	PluginManagementService = true,
	ScriptEditorService = true,
	Selection = true,
	AnalyticsService = true,
	ContextActionService = true,
	GuiService = true,
	HapticService = true,
	LogService = true,
	NetworkClient = true,
	NetworkServer = true,
	Stats = true,
	UserInputService = true,
	VRService = true,
}

local API_DUMP_URL =
	"https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/refs/heads/roblox/API-Dump.json"
local cachedApiDump = nil
local classIndexMap = {}
local classPropertiesCache = {}
local blacklistedTags = { Hidden = true, ReadOnly = true, NotScriptable = true }

local function fetchApiDump()
	if cachedApiDump then
		return true
	end
	local ok, response = pcall(function()
		return HttpService:GetAsync(API_DUMP_URL)
	end)
	if not ok or not response then
		return false
	end
	local decodedOk, data = pcall(function()
		return HttpService:JSONDecode(response)
	end)
	if not decodedOk or not data then
		return false
	end
	cachedApiDump = data
	for i, class in ipairs(data.Classes or {}) do
		classIndexMap[class.Name] = i
	end
	return true
end

local function getWritableProperties(className)
	if classPropertiesCache[className] then
		return classPropertiesCache[className]
	end

	local properties = {}
	if KNOWN_ASSET_PROPERTIES[className] then
		for _, p in ipairs(KNOWN_ASSET_PROPERTIES[className]) do
			table.insert(properties, p)
		end
	end

	if cachedApiDump then
		local apiProps = {}
		local classIndex = classIndexMap[className]
		if classIndex then
			local class = cachedApiDump.Classes[classIndex]
			if class then
				for _, member in ipairs(class.Members or {}) do
					if member.MemberType == "Property" and member.Security and member.Security.Write == "None" then
						local okTag = true
						if member.Tags then
							for _, tag in ipairs(member.Tags) do
								if blacklistedTags[tag] then
									okTag = false
									break
								end
							end
						end
						if
							okTag
							and member.ValueType
							and (
								member.ValueType.Name == "Content"
							)
						then
							table.insert(apiProps, member.Name)
						end
					end
				end
				if class.Superclass and class.Superclass ~= "<<<ROOT>>>" then
					for _, p in ipairs(getWritableProperties(class.Superclass)) do
						table.insert(apiProps, p)
					end
				end
			end
		end
		local dedupe = {}
		for _, p in ipairs(properties) do
			dedupe[p] = true
		end
		for _, p in ipairs(apiProps) do
			if not dedupe[p] then
				table.insert(properties, p)
				dedupe[p] = true
			end
		end
	end

	classPropertiesCache[className] = properties
	return properties
end

local toolbar = plugin:CreateToolbar("ISpooferMotion")
local animationsButton =
	toolbar:CreateButton("Animations", "Scan the open game for animation IDs and send them to ISpooferMotion.", ICON_ID)
local soundsButton =
	toolbar:CreateButton("Sounds", "Scan the open game for sound IDs and send them to ISpooferMotion.", ICON_ID)
local bothButton =
	toolbar:CreateButton("Both", "Scan the open game for animation and sound IDs and send them to ISpooferMotion.", ICON_ID)
animationsButton.ClickableWhenViewportHidden = true
soundsButton.ClickableWhenViewportHidden = true
bothButton.ClickableWhenViewportHidden = true

local scanInProgress = false
local replaceInProgress = false
local activeBaseUrl = BASE_URLS[1]
local completedReplacementCount = 0
local studioUserId = 0
pcall(function()
	studioUserId = plugin:GetStudioUserId()
end)

local function setButtonsEnabled(enabled)
	pcall(function()
		animationsButton.Enabled = enabled
	end)
	pcall(function()
		soundsButton.Enabled = enabled
	end)
	pcall(function()
		bothButton.Enabled = enabled
	end)
end

local function formatDuration(seconds)
	seconds = math.max(0, math.floor(tonumber(seconds) or 0))
	if seconds >= 3600 then
		local hours = math.floor(seconds / 3600)
		local minutes = math.floor((seconds % 3600) / 60)
		local secs = seconds % 60
		return string.format("%dh %02dm %02ds", hours, minutes, secs)
	elseif seconds >= 60 then
		local minutes = math.floor(seconds / 60)
		local secs = seconds % 60
		return string.format("%dm %02ds", minutes, secs)
	end
	return tostring(seconds) .. "s"
end

local function shortenText(text, maxLength)
	text = tostring(text or "")
	maxLength = tonumber(maxLength) or 120
	if #text <= maxLength then
		return text
	end
	return text:sub(1, maxLength - 3) .. "..."
end

local function safeFullName(obj)
	local ok, fullName = pcall(function()
		return obj:GetFullName()
	end)
	if ok and fullName then
		return tostring(fullName)
	end
	return tostring(obj and obj.Name or "Unknown")
end

local function summarizeMappings(ordered, maxItems)
	maxItems = tonumber(maxItems) or 3
	local parts = {}
	for i, mapping in ipairs(ordered or {}) do
		if i > maxItems then
			break
		end
		table.insert(parts, tostring(mapping.oldId) .. " -> " .. tostring(mapping.newId))
	end
	local remaining = #(ordered or {}) - #parts
	if remaining > 0 then
		table.insert(parts, "+" .. tostring(remaining) .. " more")
	end
	return table.concat(parts, "  |  ")
end

local function createDimmerProgressGui(name, titleText)
	local gui = Instance.new("ScreenGui")
	gui.Name = name
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = game:GetService("CoreGui")

	local bg = Instance.new("Frame")
	bg.BackgroundColor3 = Color3.new(0, 0, 0)
	bg.BackgroundTransparency = 0.5
	bg.Size = UDim2.fromScale(1, 1)
	bg.Parent = gui

	local statusLabel = Instance.new("TextLabel")
	statusLabel.BackgroundTransparency = 1
	statusLabel.Size = UDim2.fromScale(1, 0.18)
	statusLabel.Position = UDim2.fromScale(0, 0.28)
	statusLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
	statusLabel.Text = titleText or "Working..."
	statusLabel.TextSize = 36
	statusLabel.TextColor3 = Color3.new(1, 1, 1)
	statusLabel.TextWrapped = true
	statusLabel.Parent = bg

	local detailLabel = Instance.new("TextLabel")
	detailLabel.BackgroundTransparency = 1
	detailLabel.Size = UDim2.fromScale(0.9, 0.08)
	detailLabel.Position = UDim2.fromScale(0.05, 0.44)
	detailLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.SemiBold, Enum.FontStyle.Normal)
	detailLabel.Text = ""
	detailLabel.TextSize = 20
	detailLabel.TextColor3 = Color3.fromRGB(230, 230, 230)
	detailLabel.TextWrapped = true
	detailLabel.Parent = bg

	local etaLabel = Instance.new("TextLabel")
	etaLabel.BackgroundTransparency = 1
	etaLabel.Size = UDim2.fromScale(0.9, 0.07)
	etaLabel.Position = UDim2.fromScale(0.05, 0.52)
	etaLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
	etaLabel.Text = ""
	etaLabel.TextSize = 20
	etaLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
	etaLabel.TextWrapped = true
	etaLabel.Parent = bg

	local statsLabel = Instance.new("TextLabel")
	statsLabel.BackgroundTransparency = 1
	statsLabel.Size = UDim2.fromScale(0.9, 0.07)
	statsLabel.Position = UDim2.fromScale(0.05, 0.59)
	statsLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
	statsLabel.Text = ""
	statsLabel.TextSize = 18
	statsLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
	statsLabel.TextWrapped = true
	statsLabel.Parent = bg

	local extraLabel = Instance.new("TextLabel")
	extraLabel.BackgroundTransparency = 1
	extraLabel.Size = UDim2.fromScale(0.9, 0.1)
	extraLabel.Position = UDim2.fromScale(0.05, 0.66)
	extraLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
	extraLabel.Text = ""
	extraLabel.TextSize = 16
	extraLabel.TextColor3 = Color3.fromRGB(180, 180, 180)
	extraLabel.TextWrapped = true
	extraLabel.Parent = bg

	return {
		gui = gui,
		statusLabel = statusLabel,
		detailLabel = detailLabel,
		etaLabel = etaLabel,
		statsLabel = statsLabel,
		extraLabel = extraLabel,
		destroy = function()
			if gui then
				gui:Destroy()
			end
		end,
	}
end
local function isValidId(id)
	if string.sub(id, 1, 1) == "0" then
		return false
	end
	local n = tonumber(id)
	if not n or n == 0 or n % 1 ~= 0 then
		return false
	end
	local len = #tostring(math.floor(math.abs(n)))
	return len >= 7 and len <= 15
end

local function addId(ids, value, objName, isConfirmed, assetTypeName)
	local text = tostring(value or "")
	for id in text:gmatch("(%d+)") do
		if isValidId(id) then
			if not ids[id] then
				ids[id] = { name = objName or "Unknown", confirmed = isConfirmed, assetTypeName = assetTypeName }
			else
				if isConfirmed then
					ids[id].confirmed = true
				end
				if assetTypeName and not ids[id].assetTypeName then
					ids[id].assetTypeName = assetTypeName
				end
				if
					objName
					and objName ~= "Unknown"
					and (ids[id].name == "Unknown" or ids[id].name:lower() == "script")
				then
					ids[id].name = objName
				end
			end
		end
	end
end

local function addNestedIds(ids, value, visited, objName, isConfirmed)
	if type(value) ~= "table" then
		addId(ids, value, objName, isConfirmed)
		return
	end
	visited = visited or {}
	if visited[value] then
		return
	end
	visited[value] = true
	for key, nestedValue in pairs(value) do
		addId(ids, key, objName, isConfirmed)
		addNestedIds(ids, nestedValue, visited, objName, isConfirmed)
	end
end

local function collectIdsFromSource(source, ids, defaultObjName, checkYield, kind)
	local animationKeywords = {
		-- Core
		"anim", "track", "clip", "motion", "gesture", "stance", "pose", "action", "move", "seq", "sequence",
		-- Movement
		"idle", "walk", "run", "sprint", "dash", "dodge", "roll", "jump", "fall", "land", "climb", "swim", "crouch", "crawl", "slide", "dive", "fly", "hover", "glide", "strafe",
		-- Combat Melee
		"punch", "kick", "slash", "swing", "stab", "thrust", "block", "parry", "strike", "bash", "slam", "sweep", "smash", "attack", "combo",
		-- Combat Ranged
		"shoot", "fire", "reload", "aim", "recoil", "pump", "chamber", "throw", "toss", "lob", "equip", "unequip", "hold",
		-- Magic & Skills
		"cast", "spell", "magic", "skill", "ability", "ult", "special", "heal", "buff", "aura", "blast", "burst",
		-- Reactions & States
		"death", "die", "dead", "hurt", "hit", "damage", "stun", "flinch", "stagger", "knock", "ragdoll", "emote",
		-- General
		"use", "interact", "load", "play"
	}
	
	local soundKeywords = {
		-- Core
		"sound", "audio", "music", "track", "play", "sfx", "bgm", "ost", "song", "loop", "noise", "voice",
		-- Speech
		"dialogue", "dial", "talk", "chat", "bark", "roar", "scream",
		-- Impacts & FX
		"step", "footstep", "impact", "clash", "whoosh", "swish", "bang", "boom", "pop", "click", "ui", "hover", "press", "fx"
	}

	local actionKeywords = {}
	if kind == "animation" then
		for _, kw in ipairs(animationKeywords) do
			table.insert(actionKeywords, kw)
		end
	elseif kind == "sound" then
		for _, kw in ipairs(soundKeywords) do
			table.insert(actionKeywords, kw)
		end
	else
		for _, kw in ipairs(animationKeywords) do
			table.insert(actionKeywords, kw)
		end
		for _, kw in ipairs(soundKeywords) do
			table.insert(actionKeywords, kw)
		end
	end

	local function hasActionKeyword(text)
		if not text then
			return false
		end
		local t = text:lower()
		for _, kw in ipairs(actionKeywords) do
			if t:find(kw, 1, true) then
				return true
			end
		end
		return false
	end

	local init = 1
	local len = #source
	local finds = 0

	-- Global 'return { ... }' module parsing for modules named with keywords
	if hasActionKeyword(defaultObjName) then
		local retContent = source:match("return%s*%{([^}]*)%}")
		if retContent then
			for tblId in retContent:gmatch("(%d+)") do
				addId(ids, tblId, defaultObjName, false)
			end
		end
	end

	while init <= len do
		local s, e, id = source:find("(%d+)", init)
		if not s then
			break
		end

		finds = finds + 1
		if finds % 500 == 0 and checkYield then
			checkYield()
		end

		local contextStart = math.max(1, s - 250)
		local context = source:sub(contextStart, s - 1)

		local confirmed = false
		local name = defaultObjName

		local lineStart = context:match("[^\r\n]*$") or context
		local isExplicitUri = lineStart:match("rbxassetid://%s*$") 
			or lineStart:match("asset/?%?id=%s*$") 
			or lineStart:match("roblox%.com/asset/?%?id=%s*$")
			or lineStart:match("LoadAnimation%s*%($")
			or lineStart:match("PreloadAsync%s*%($")
			or lineStart:match("PlayLocalSound%s*%($")

		if isExplicitUri then
			confirmed = true
		else
			local words = {}
			for word in context:gmatch("[%a_][%w_]*") do
				table.insert(words, word)
			end
			
			local checkCount = math.min(4, #words)
			for i = #words, #words - checkCount + 1, -1 do
				if hasActionKeyword(words[i]) then
					confirmed = true
					name = words[i]
					break
				end
			end
		end

		if confirmed then
			addId(ids, id, name, true)
		elseif #id >= 6 then
			addId(ids, id, "Unknown (No Keyword)", false)
		end

		init = e + 1
	end
end

local function collectIdsFromObject(obj, ids, checkYield, kind)
	local objName = obj.Name or "Unknown"
	if obj:IsA("Animation") then
		if kind ~= "sound" then
			addId(ids, obj.AnimationId, objName, true, "Animation")
		end
		return
	end

	if obj:IsA("Sound") then
		if kind ~= "animation" then
			addId(ids, obj.SoundId, objName, true, "Audio")
			local ok, ac = pcall(function()
				return obj.AudioContent
			end)
			if ok then
				addId(ids, ac, objName, true, "Audio")
			end
		end
		return
	end

	if obj:IsA("AudioPlayer") then
		if kind ~= "animation" then
			for _, prop in ipairs({ "Asset", "AssetId", "AudioContent" }) do
				local ok, v = pcall(function()
					return obj[prop]
				end)
				if ok then
					addId(ids, v, objName, true, "Audio")
				end
			end
		end
		return
	end
	if obj:IsA("HumanoidDescription") then
		if kind ~= "sound" then
			for _, prop in ipairs(HUMANOID_DESCRIPTION_ANIMATION_PROPERTIES) do
				local ok, v = pcall(function()
					return obj[prop]
				end)
				if ok then
					addId(ids, v, objName, true, "Animation")
				end
			end
			local okE, emotes = pcall(function()
				return obj:GetEmotes()
			end)
			if okE and emotes then
				addNestedIds(ids, emotes, nil, objName, true)
			end
		end
		return
	end
	if obj:IsA("LuaSourceContainer") then
		local ok, source = pcall(function()
			return obj.Source
		end)
		if ok and source and #source > 0 then
			collectIdsFromSource(source, ids, objName, checkYield, kind)
		end
		return
	end
	if obj:IsA("StringValue") then
		local ok, v = pcall(function()
			return obj.Value
		end)
		if ok and type(v) == "string" then
			for idStr in v:gmatch("(%d+)") do
				addId(ids, idStr, objName, false)
			end
		end
	elseif obj:IsA("NumberValue") or obj:IsA("IntValue") then
		local ok, v = pcall(function()
			return obj.Value
		end)
		if ok then
			addId(ids, tostring(math.floor(v or 0)), objName, false)
		end
	end
	local knownProps = KNOWN_ASSET_PROPERTIES[obj.ClassName]
	if knownProps then
		for _, prop in ipairs(knownProps) do
			local ok, v = pcall(function()
				return obj[prop]
			end)
			if ok then
				addId(ids, v, objName, false)
			end
		end
		return
	end
	local apiProps = getWritableProperties(obj.ClassName)
	for _, prop in ipairs(apiProps) do
		local ok, v = pcall(function()
			return obj[prop]
		end)
		if ok and v ~= nil then
			addId(ids, v, objName, false)
		end
	end
	local okA, attrs = pcall(function()
		return obj:GetAttributes()
	end)
	if okA and attrs then
		for _, attrVal in pairs(attrs) do
			if type(attrVal) == "string" then
				for idStr in attrVal:gmatch("(%d+)") do
					addId(ids, idStr, objName, false)
				end
			else
				addNestedIds(ids, attrVal, nil, objName, false)
			end
		end
	end
end

local function traverseValidDescendants(callback, progressCallback)
	local count = 0
	local lastYield = os.clock()

	local function checkYield()
		if os.clock() - lastYield > 0.05 then
			if progressCallback then
				progressCallback(count)
			end
			task.wait()
			lastYield = os.clock()
		end
	end

	for _, service in ipairs(game:GetChildren()) do
		if not IGNORED_ROOTS[service.Name] then
			count += 1
			callback(service, count, checkYield)

			local descendants = service:GetDescendants()
			for i, obj in ipairs(descendants) do
				count += 1
				callback(obj, count, checkYield)
				checkYield()
			end
		end
	end
	if progressCallback then
		progressCallback(count)
	end
	return count
end

local function addReplacement(replacements, ordered, oldId, newId)
	oldId = tostring(oldId or ""):match("(%d%d%d%d%d+)") or ""
	newId = tostring(newId or ""):match("(%d%d%d%d%d+)") or ""
	if oldId == "" or newId == "" or oldId == newId or replacements[oldId] then
		return
	end
	replacements[oldId] = newId
	table.insert(ordered, { oldId = oldId, newId = newId })
end

local function parseReplacementMappings(text)
	text = tostring(text or "")
	local replacements = {}
	local ordered = {}
	for oldId, newId in text:gmatch("(%d%d%d%d%d+)%s*=%s*(%d%d%d%d%d+)") do
		addReplacement(replacements, ordered, oldId, newId)
	end
	for oldId, newId in text:gmatch("(%d%d%d%d%d+)%s*[-=]+>%s*(%d%d%d%d%d+)") do
		addReplacement(replacements, ordered, oldId, newId)
	end
	for oldId, newId in text:gmatch("Original ID:%s*(%d%d%d%d%d+).-New Asset ID:%s*(%d%d%d%d%d+)") do
		addReplacement(replacements, ordered, oldId, newId)
	end
	for oldId, newId in text:gmatch("Original ID:%s*(%d%d%d%d%d+).-Overwrote Asset ID:%s*(%d%d%d%d%d+)") do
		addReplacement(replacements, ordered, oldId, newId)
	end
	return replacements, ordered
end

local function replaceIdsInText(text, replacements, ordered)
	local total = 0
	local nextText = tostring(text or "")
	nextText = nextText:gsub("(%d%d%d%d%d%d%d+)", function(id)
		local replacement = replacements[id]
		if replacement then
			total += 1
			return replacement
		end
		return id
	end)
	return nextText, total
end

local function replaceNumericValue(value, replacements)
	local id = tostring(math.floor(tonumber(value) or -1))
	local replacement = replacements[id]
	if replacement then
		return tonumber(replacement), 1
	end
	return value, 0
end

local function replaceNestedValue(value, replacements, ordered, visited)
	if type(value) == "string" then
		return replaceIdsInText(value, replacements, ordered)
	elseif type(value) == "number" then
		return replaceNumericValue(value, replacements)
	elseif type(value) ~= "table" then
		return value, 0
	end
	visited = visited or {}
	if visited[value] then
		return value, 0
	end
	visited[value] = true
	local changed = 0
	for key, nestedValue in pairs(value) do
		local nextValue, nestedChanged = replaceNestedValue(nestedValue, replacements, ordered, visited)
		if nestedChanged > 0 then
			value[key] = nextValue
			changed += nestedChanged
		end
	end
	return value, changed
end

local function replacePropertyValue(obj, propertyName, replacements, ordered, stats)
	local okRead, value = pcall(function()
		return obj[propertyName]
	end)
	if not okRead or value == nil then
		return
	end
	local nextValue, changed = replaceNestedValue(value, replacements, ordered)
	if changed <= 0 or nextValue == value then
		return
	end
	local okWrite = pcall(function()
		obj[propertyName] = nextValue
	end)
	if okWrite then
		stats.replacements += changed
		stats.objects += 1
	else
		stats.failed += 1
	end
end

local function replacePropertyText(obj, propertyName, replacements, ordered, stats)
	local okRead, value = pcall(function()
		return obj[propertyName]
	end)
	if not okRead or value == nil then
		return
	end
	local isNum = type(value) == "number"
	local strVal = tostring(value)
	local nextStr, changed = replaceIdsInText(strVal, replacements, ordered)
	if changed <= 0 or nextStr == strVal then
		return
	end
	local nextValue = isNum and tonumber(nextStr) or nextStr
	if nextValue == nil then
		nextValue = nextStr
	end
	local okWrite = pcall(function()
		obj[propertyName] = nextValue
	end)
	if okWrite then
		stats.replacements += changed
		stats.objects += 1
	else
		stats.failed += 1
	end
end

local function replaceValueObject(obj, replacements, ordered, stats)
	local okRead, value = pcall(function()
		return obj.Value
	end)
	if not okRead then
		return
	end
	local nextValue = value
	local changed = 0
	if type(value) == "string" then
		nextValue, changed = replaceIdsInText(value, replacements, ordered)
	elseif type(value) == "number" then
		nextValue, changed = replaceNumericValue(value, replacements)
	end
	if changed <= 0 or nextValue == value then
		return
	end
	local okWrite = pcall(function()
		obj.Value = nextValue
	end)
	if okWrite then
		stats.replacements += changed
		stats.objects += 1
	else
		stats.failed += 1
	end
end

local function replaceAttributes(obj, replacements, ordered, stats)
	local okAttributes, attributes = pcall(function()
		return obj:GetAttributes()
	end)
	if not okAttributes or not attributes then
		return
	end
	local changedAttributes = 0
	for name, value in pairs(attributes) do
		local nextValue, changed = replaceNestedValue(value, replacements, ordered)
		if changed > 0 and nextValue ~= value then
			local okWrite = pcall(function()
				obj:SetAttribute(name, nextValue)
			end)
			if okWrite then
				stats.replacements += changed
				changedAttributes += 1
			else
				stats.failed += 1
			end
		end
	end
	if changedAttributes > 0 then
		stats.objects += 1
	end
end

local function replaceTags(obj, replacements, ordered, stats)
	local okTags, tags = pcall(function()
		return CollectionService:GetTags(obj)
	end)
	if not okTags or not tags then
		return
	end
	local changedTags = 0
	for _, tag in ipairs(tags) do
		local nextTag, changed = replaceIdsInText(tag, replacements, ordered)
		if changed > 0 and nextTag ~= tag then
			local okWrite = pcall(function()
				CollectionService:RemoveTag(obj, tag)
				CollectionService:AddTag(obj, nextTag)
			end)
			if okWrite then
				stats.replacements += changed
				changedTags += 1
			else
				stats.failed += 1
			end
		end
	end
	if changedTags > 0 then
		stats.objects += 1
	end
end

local function replaceHumanoidDescriptionAnimations(obj, replacements, ordered, stats)
	for _, propertyName in ipairs(HUMANOID_DESCRIPTION_ANIMATION_PROPERTIES) do
		replacePropertyValue(obj, propertyName, replacements, ordered, stats)
	end
	local okEmotes, emotes = pcall(function()
		return obj:GetEmotes()
	end)
	if not okEmotes or not emotes then
		return
	end
	local nextEmotes, changed = replaceNestedValue(emotes, replacements, ordered)
	if changed <= 0 then
		return
	end
	local okWrite = pcall(function()
		obj:SetEmotes(nextEmotes)
	end)
	if okWrite then
		stats.replacements += changed
		stats.objects += 1
	else
		stats.failed += 1
	end
end

local function replaceIdsInObject(obj, replacements, ordered, stats)
	if obj:IsA("HumanoidDescription") then
		replaceHumanoidDescriptionAnimations(obj, replacements, ordered, stats)
	end
	if obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue") then
		replaceValueObject(obj, replacements, ordered, stats)
	end

	if obj:IsA("Animation") then
		replacePropertyText(obj, "AnimationId", replacements, ordered, stats)
	elseif obj:IsA("Sound") then
		replacePropertyText(obj, "SoundId", replacements, ordered, stats)
		replacePropertyText(obj, "AudioContent", replacements, ordered, stats)
	elseif obj:IsA("AudioPlayer") then
		replacePropertyText(obj, "Asset", replacements, ordered, stats)
		replacePropertyText(obj, "AssetId", replacements, ordered, stats)
		replacePropertyText(obj, "AudioContent", replacements, ordered, stats)
	elseif obj:IsA("LuaSourceContainer") then
		replacePropertyText(obj, "Source", replacements, ordered, stats)
	end

	local props = getWritableProperties(obj.ClassName)
	local alreadyHandled = {
		AnimationId = true,
		SoundId = true,
		AudioContent = true,
		Asset = true,
		AssetId = true,
		Source = true,
		Value = true,
	}
	for _, propName in ipairs(props) do
		if not alreadyHandled[propName] then
			replacePropertyText(obj, propName, replacements, ordered, stats)
		end
	end

	replaceAttributes(obj, replacements, ordered, stats)
	replaceTags(obj, replacements, ordered, stats)
end

local function collectValidObjects(progressCallback)
	local objects = {}
	local lastYield = os.clock()
	for _, service in ipairs(game:GetChildren()) do
		if not IGNORED_ROOTS[service.Name] then
			table.insert(objects, service)
			if progressCallback then
				progressCallback(#objects, service)
			end
			local descendants = service:GetDescendants()
			for i, obj in ipairs(descendants) do
				table.insert(objects, obj)
				if os.clock() - lastYield > 0.05 then
					if progressCallback then
						progressCallback(#objects, service)
					end
					task.wait()
					lastYield = os.clock()
				end
			end
		end
	end
	if progressCallback then
		progressCallback(#objects, objects[#objects])
	end
	return objects
end

local function replaceOpenGame(text, progressCallback)
	local replacements, ordered = parseReplacementMappings(text)
	if #ordered == 0 then
		return false, "No replacement mappings found from the app output."
	end

	local startedAt = os.clock()
	local stats = {
		phase = "Reading mappings",
		mappings = #ordered,
		mappingPreview = summarizeMappings(ordered, 4),
		totalObjects = 0,
		scannedObjects = 0,
		objects = 0,
		replacements = 0,
		failed = 0,
		elapsedSeconds = 0,
		etaSeconds = nil,
		currentObject = "",
	}

	local function publish(force)
		stats.elapsedSeconds = os.clock() - startedAt
		if stats.totalObjects > 0 and stats.scannedObjects > 0 and stats.scannedObjects < stats.totalObjects then
			local averageTime = stats.elapsedSeconds / stats.scannedObjects
			stats.etaSeconds = math.ceil((stats.totalObjects - stats.scannedObjects) * averageTime)
		elseif stats.totalObjects > 0 and stats.scannedObjects >= stats.totalObjects then
			stats.etaSeconds = 0
		else
			stats.etaSeconds = nil
		end
		if progressCallback then
			progressCallback(stats, force == true)
		end
	end

	publish(true)
	stats.phase = "Preparing instances"
	local objects = collectValidObjects(function(count, obj)
		stats.totalObjects = count
		stats.currentObject = shortenText(safeFullName(obj), 120)
		publish(false)
	end)

	stats.totalObjects = #objects
	stats.scannedObjects = 0
	stats.phase = "Replacing IDs"
	stats.currentObject = ""
	publish(true)

	local lastYield = os.clock()
	for i, obj in ipairs(objects) do
		stats.scannedObjects = i
		stats.currentObject = shortenText(safeFullName(obj), 120)
		replaceIdsInObject(obj, replacements, ordered, stats)
		if os.clock() - lastYield > 0.05 or i == #objects then
			publish(i == #objects)
			task.wait()
			lastYield = os.clock()
		end
	end

	stats.phase = "Finished"
	stats.scannedObjects = stats.totalObjects
	stats.currentObject = ""
	publish(true)

	return true, stats
end

local function addPropertyIdsFromObject(obj, propertyName, ids)
	local okRead, value = pcall(function()
		return obj[propertyName]
	end)
	if okRead and value ~= nil then
		addNestedIds(ids, value)
	end
end

local function collectHumanoidDescriptionAnimationIds(obj, ids)
	for _, propertyName in ipairs(HUMANOID_DESCRIPTION_ANIMATION_PROPERTIES) do
		addPropertyIdsFromObject(obj, propertyName, ids)
	end
	local okEmotes, emotes = pcall(function()
		return obj:GetEmotes()
	end)
	if okEmotes and emotes then
		addNestedIds(ids, emotes)
	end
end

local function collectIdsFromObject(obj, ids)
	local objName = obj.Name or "Unknown"
	local props = getWritableProperties(obj.ClassName)
	if #props > 0 then
		for _, propName in ipairs(props) do
			addPropertyIdsFromObject(obj, propName, ids)
		end
	else
		if obj:IsA("Animation") then
			addId(ids, obj.AnimationId, objName)
		elseif obj:IsA("Sound") then
			addId(ids, obj.SoundId, objName)
			addPropertyIdsFromObject(obj, "AudioContent", ids)
		elseif obj:IsA("AudioPlayer") then
			addPropertyIdsFromObject(obj, "Asset", ids)
			addPropertyIdsFromObject(obj, "AssetId", ids)
			addPropertyIdsFromObject(obj, "AudioContent", ids)
		end
	end

	if obj:IsA("HumanoidDescription") then
		collectHumanoidDescriptionAnimationIds(obj, ids)
	elseif obj:IsA("LuaSourceContainer") then
		local ok, source = pcall(function()
			return obj.Source
		end)
		if ok and source then
			collectIdsFromSource(source, ids)
		end
	elseif obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue") then
		local ok, value = pcall(function()
			return obj.Value
		end)
		if ok then
			addId(ids, value, objName)
		end
	end

	local okAttributes, attributes = pcall(function()
		return obj:GetAttributes()
	end)
	if okAttributes and attributes then
		for _, attributeValue in pairs(attributes) do
			addNestedIds(ids, attributeValue, nil, objName)
		end
	end

	local okTags, tags = pcall(function()
		return CollectionService:GetTags(obj)
	end)
	if okTags and tags then
		for _, tag in ipairs(tags) do
			addId(ids, tag, objName)
		end
	end
end

local function sortedIds(idsMap)
	local list = {}
	local names = {}
	local assetTypes = {}
	local confirmed = {}
	for id, data in pairs(idsMap) do
		table.insert(list, id)
		names[id] = data.name
		if data.assetTypeName then
			assetTypes[id] = data.assetTypeName
		end
		if data.confirmed then
			table.insert(confirmed, id)
		end
	end
	table.sort(list, function(a, b)
		return tonumber(a) < tonumber(b)
	end)
	return list, names, assetTypes, confirmed
end

local function scanOpenGame(kind, progressCallback)
	local ids = {}
	local scannedObjects = traverseValidDescendants(function(obj, count, checkYield)
		collectIdsFromObject(obj, ids, checkYield, kind)
	end, progressCallback)
	return ids, scannedObjects
end

local function requestJson(method, url, payload)
	local body = payload and HttpService:JSONEncode(payload) or nil
	return HttpService:RequestAsync({
		Url = url,
		Method = method,
		Headers = { ["Content-Type"] = "application/json" },
		Body = body,
	})
end

local function tryHealth(baseUrl)
	local ok, response = pcall(function()
		return requestJson("GET", baseUrl .. "/health")
	end)
	if not ok or not response or not response.Success then
		return false
	end
	local decodedOk, body = pcall(function()
		return HttpService:JSONDecode(response.Body or "")
	end)
	return decodedOk and body and body.ok == true and body.app == "ISpooferMotion"
end

local function findAppBaseUrl()
	if activeBaseUrl and tryHealth(activeBaseUrl) then
		return activeBaseUrl
	end
	for _, baseUrl in ipairs(BASE_URLS) do
		if tryHealth(baseUrl) then
			activeBaseUrl = baseUrl
			return baseUrl
		end
	end
	return nil
end

local function postScanResults(payload)
	local baseUrl = findAppBaseUrl()
	if not baseUrl then
		return false,
			"The ISpooferMotion desktop app was not reachable on localhost ports " .. tostring(PORT) .. "-" .. tostring(
				MAX_PORT
			) .. ". Open the app and make sure Studio HTTP requests are enabled."
	end
	local lastError = nil
	for attempt = 1, 3 do
		local ok, response = pcall(function()
			return requestJson("POST", baseUrl .. "/plugin-scan", payload)
		end)
		if ok and response and response.Success then
			activeBaseUrl = baseUrl
			return true, response.Body
		end
		if ok and response then
			lastError = tostring(response.StatusCode) .. " " .. tostring(response.StatusMessage or response.Body or "")
		else
			lastError = tostring(response)
		end
		task.wait(0.25 * attempt)
	end
	return false, lastError or "Unknown localhost POST failure"
end

local pollingActive = false
local pollingEnabled = true
local function runReplacementWithText(text)
	if replaceInProgress then
		warn("[ISpooferMotion] Replacement is already running.")
		return
	end
	replaceInProgress = true
	setButtonsEnabled(false)
	print("[ISpooferMotion] Auto-Replace started.")

	if not cachedApiDump then
		print("[ISpooferMotion] Fetching Roblox API Dump...")
		fetchApiDump()
	end

	local gui = createDimmerProgressGui("ISpooferMotionReplacementProgress", "Auto-Replace starting...")
	local lastUiUpdate = 0
	local function updateGui(stats, force)
		if not gui then
			return
		end
		local now = os.clock()
		if force ~= true and now - lastUiUpdate < 0.08 then
			return
		end
		lastUiUpdate = now
		local phase = tostring(stats.phase or "Replacing IDs")
		local total = tonumber(stats.totalObjects or 0) or 0
		local scanned = tonumber(stats.scannedObjects or 0) or 0
		local elapsed = tonumber(stats.elapsedSeconds or 0) or 0
		local eta = stats.etaSeconds
		gui.statusLabel.Text = phase
		if total > 0 then
			gui.detailLabel.Text = string.format("Processed %d / %d instances", scanned, total)
		else
			gui.detailLabel.Text = string.format("Prepared %d instances", total)
		end
		local etaText = eta ~= nil and formatDuration(eta) or "calculating..."
		gui.etaLabel.Text = "Elapsed: " .. formatDuration(elapsed) .. "  |  ETA: " .. etaText
		gui.statsLabel.Text = string.format(
			"Mappings: %d  |  Replacements: %d  |  Changed objects: %d  |  Failed writes: %d",
			tonumber(stats.mappings or 0) or 0,
			tonumber(stats.replacements or 0) or 0,
			tonumber(stats.objects or 0) or 0,
			tonumber(stats.failed or 0) or 0
		)
		local currentObject = tostring(stats.currentObject or "")
		local mappingPreview = tostring(stats.mappingPreview or "")
		if currentObject ~= "" then
			gui.extraLabel.Text = "Current: " .. currentObject .. "\nMappings: " .. mappingPreview
		else
			gui.extraLabel.Text = "Mappings: " .. mappingPreview
		end
	end

	task.spawn(function()
		ChangeHistoryService:SetWaypoint("ISpooferMotion: Before Replacement")
		local ok, success, statsOrMessage = pcall(function()
			return replaceOpenGame(text, updateGui)
		end)
		if not ok then
			warn("[ISpooferMotion] Replacement failed: " .. tostring(success))
			if gui then
				gui.statusLabel.Text = "Auto-Replace failed"
				gui.detailLabel.Text = shortenText(tostring(success), 160)
				gui.etaLabel.Text = ""
				gui.statsLabel.Text = ""
				gui.extraLabel.Text = ""
			end
			task.wait(1.5)
		elseif not success then
			warn("[ISpooferMotion] " .. tostring(statsOrMessage))
			if gui then
				gui.statusLabel.Text = "Auto-Replace skipped"
				gui.detailLabel.Text = tostring(statsOrMessage)
				gui.etaLabel.Text = ""
				gui.statsLabel.Text = ""
				gui.extraLabel.Text = ""
			end
			task.wait(1.5)
		else
			ChangeHistoryService:SetWaypoint("ISpooferMotion: After Replacement")
			local stats = statsOrMessage
			updateGui(stats, true)
			local message = string.format(
				"Auto-Replace finished. %d replacement(s) across %d object(s). %d mapping(s), %d failed write(s).",
				stats.replacements,
				stats.objects,
				stats.mappings,
				stats.failed
			)
			print("[ISpooferMotion] " .. message)
			if tonumber(stats.replacements or 0) > 0 then
				completedReplacementCount += 1
			end
			if gui then
				gui.statusLabel.Text = "Auto-Replace finished"
				gui.detailLabel.Text =
					string.format("%d replacement(s) across %d object(s)", stats.replacements, stats.objects)
				gui.etaLabel.Text = "Elapsed: " .. formatDuration(stats.elapsedSeconds or 0) .. "  |  ETA: 0s"
			end
			task.wait(1)
		end
		if gui then
			gui.destroy()
		end
		replaceInProgress = false
		setButtonsEnabled(true)
	end)
end

local function markApplied(baseUrl)
	pcall(function()
		requestJson("POST", baseUrl .. "/mark-replacement-applied", {})
	end)
end

local function pollForPendingReplacement()
	if pollingActive then
		return
	end
	pollingActive = true
	task.spawn(function()
		local waitInterval = 3
		local MAX_WAIT_INTERVAL = 30
		while pollingEnabled do
			task.wait(waitInterval)
			if not pollingEnabled then break end
			if not replaceInProgress and not scanInProgress then
				local baseUrl = findAppBaseUrl()
				if baseUrl then
					waitInterval = 3  -- reset backoff on successful connection
					local ok, response = pcall(function()
						return requestJson("GET", baseUrl .. "/pending-replacement")
					end)
					if ok and response and response.Success then
						local decodedOk, body = pcall(function()
							return HttpService:JSONDecode(response.Body or "")
						end)
						if decodedOk and body and body.ok == true and body.pending == true then
							local text = tostring(body.text or "")
							if text ~= "" then
								print("[ISpooferMotion] Auto-Replace: Applying...")
								runReplacementWithText(text)
								while replaceInProgress do
									task.wait(0.5)
								end
								markApplied(baseUrl)
								print("[ISpooferMotion] Auto-Replace: Applied.")
							end
						end
					end
				else
					-- Exponential backoff when app is not found
					waitInterval = math.min(waitInterval * 2, MAX_WAIT_INTERVAL)
				end
			end
		end
	end)
end

local function runScan(kind)
	if scanInProgress then
		warn("[ISpooferMotion] A scan is already running.")
		return
	end
	scanInProgress = true
	setButtonsEnabled(false)

	local label = kind == "sound" and "Sounds" or (kind == "both" and "Animations + Sounds" or "Animations")
	local statusText = "Starting " .. label .. " scan..."
	print("[ISpooferMotion] " .. label .. " scan started.")

	if not cachedApiDump then
		print("[ISpooferMotion] Fetching Roblox API Dump...")
		fetchApiDump()
	end

	local gui = Instance.new("ScreenGui")
	gui.Name = "ISpooferMotionDimmer"
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = game:GetService("CoreGui")

	local bg = Instance.new("Frame")
	bg.BackgroundColor3 = Color3.new(0, 0, 0)
	bg.BackgroundTransparency = 0.5
	bg.Size = UDim2.fromScale(1, 1)
	bg.Parent = gui

	local textLabel = Instance.new("TextLabel")
	textLabel.BackgroundTransparency = 1
	textLabel.Size = UDim2.fromScale(1, 1)
	textLabel.Position = UDim2.new(0, 0, 0, -20)
	textLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
	textLabel.Text = statusText
	textLabel.TextSize = 36
	textLabel.TextColor3 = Color3.new(1, 1, 1)
	textLabel.Parent = bg

	local etaLabel = Instance.new("TextLabel")
	etaLabel.BackgroundTransparency = 1
	etaLabel.Size = UDim2.fromScale(1, 1)
	etaLabel.Position = UDim2.new(0, 0, 0, 30)
	etaLabel.FontFace =
		Font.new("rbxasset://fonts/families/Montserrat.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
	etaLabel.Text = ""
	etaLabel.TextSize = 20
	etaLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
	etaLabel.Parent = bg

	task.spawn(function()
		local ok, err = pcall(function()
			local startedAt = os.clock()
			local scanStart = os.clock()
			local scanKind = kind == "both" and "mixed" or kind
			local ids, scannedObjects = scanOpenGame(kind, function(count)
				local elapsed = math.floor((os.clock() - scanStart) * 10) / 10
				textLabel.Text = string.format("Scanning %s... (%d objects)", label, count)
				etaLabel.Text = "Elapsed: " .. tostring(elapsed) .. "s"
			end)
			etaLabel.Text = ""
			local idsArray, idsNames, assetTypes, confirmedIds = sortedIds(ids)
			print(
				string.format("[ISpooferMotion] Found %d raw potential IDs in %d objects.", #idsArray, scannedObjects)
			)

			if #idsArray == 0 then
				warn("Animations scan received, but no importable IDs were found.")
				return
			end

			local payload = {
				kind = scanKind,
				version = PLUGIN_VERSION,
				placeId = game.PlaceId,
				gameId = game.GameId,
				gameCreatorId = game.CreatorId,
				gameCreatorType = game.CreatorType.Value,
				studioUserId = studioUserId,
				scannedAt = os.time(),
				elapsedMs = math.floor((os.clock() - startedAt) * 1000),
				candidateCount = #idsArray,
				ids = idsArray,
				names = idsNames,
				assetTypes = assetTypes,
				confirmedIds = confirmedIds,
			}

			textLabel.Text = "Sending to app..."
			local sent, message = postScanResults(payload)
			if sent then
				print(
					string.format(
						"[ISpooferMotion] %s scan finished. %d candidate ID(s) sent to the app.",
						label,
						#idsArray
					)
				)
				textLabel.Text = "Sent to app! App is resolving the metadata..."
				task.wait(1.5)
			else
				warn(
					"[ISpooferMotion] "
						.. label
						.. " scan finished, but sending to the app failed: "
						.. tostring(message)
				)
				textLabel.Text = "Failed to send to app."
				task.wait(1.5)
			end
		end)

		if not ok then
			warn("[ISpooferMotion] " .. label .. " scan failed: " .. tostring(err))
			textLabel.Text = "Scan failed: " .. tostring(err)
			task.wait(1.5)
		end

		scanInProgress = false
		setButtonsEnabled(true)
		gui:Destroy()
	end)
end

animationsButton.Click:Connect(function()
	runScan("animation")
end)
soundsButton.Click:Connect(function()
	runScan("sound")
end)
bothButton.Click:Connect(function()
	runScan("both")
end)

print(
	"[ISpooferMotion] Plugin loaded (v"
		.. tostring(PLUGIN_VERSION)
		.. "). Open the desktop app, then click Animations, Sounds, or Both."
)
pollForPendingReplacement()

