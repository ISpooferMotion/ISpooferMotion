--[[Plugin Environment Stuff]]--
local pluginEnvironment = script.Parent
local pluginSettings = pluginEnvironment.Settings
local modules = pluginEnvironment.Modules
local utils = pluginEnvironment.Utils
local assets = pluginEnvironment.Assets

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")

--[[Toolbar Stuff]]--
local toolbar = plugin:CreateToolbar("AssetCollection Test")
local button = toolbar:CreateButton("Run", "Gets the stuff", "rbxassetid://137844667859456")
local pollButton = toolbar:CreateButton("Poll", "Toggle server polling", "rbxassetid://137844667859456")
button.ClickableWhenViewportHidden = true
pollButton.ClickableWhenViewportHidden = true

--[[Config]]--
local PORT = 3100
local BATCH_SIZE = 2000
local BASE_URL = "http://localhost:" .. PORT
local TESTING = false -- Set to false to send via HTTP

--[[Tables & Variables]]--
local Assets = {}
local Animations = {}
local Sounds = {}
local Scripts = {}
local Images = {}
local Meshes = {}

local seenAnimations = {}
local seenSounds = {}
local seenImages = {}
local seenMeshes = {}

local polling = false
local pollTask = nil

--[[Functions]]--
local function timeit(func)
	local startTime = os.clock()
	func()
	local endTime = os.clock()
	return math.round((endTime - startTime) * 1000)
end

local function sendToServer(endpoint, payload)
	if TESTING then
		print("[TESTING] POST to " .. endpoint)
		print(HttpService:JSONEncode(payload))
		return
	end
	local ok, err = pcall(function()
		HttpService:PostAsync(
			BASE_URL .. endpoint,
			HttpService:JSONEncode(payload),
			Enum.HttpContentType.ApplicationJson
		)
	end)
	if not ok then
		warn("[AssetCollection] Failed to POST to " .. endpoint .. ": " .. tostring(err))
	end
end

local IGNORED_SERVICES = {
	PluginGuiService = true,
	CoreGui = true,
}

local function initialScan()
	print("started")
	local all = game:GetDescendants()
	for _, obj in ipairs(all) do
		-- Skip objects that live under ignored services
		local root = obj
		while root.Parent and root.Parent ~= game do
			root = root.Parent
		end
		if not IGNORED_SERVICES[root.Name] then
			table.insert(Assets, obj)
		end
	end
	print("Filtered assets:", #Assets, "(excluded PluginGuiService, CoreGui)")
end

-- Roblox AssetTypeId mapping from GetProductInfo
-- 24 = Animation, 3 = Audio, 1 = Image, 13 = Decal, 40 = MeshPart, 4 = Mesh, 10 = Model
local ASSET_TYPE_ANIMATION = {[24] = true, [61] = true}
local ASSET_TYPE_SOUND = {[3] = true}
local ASSET_TYPE_IMAGE = {[1] = true, [13] = true}
local ASSET_TYPE_MESH = {[4] = true, [40] = true}

local assetTypeCache = {}

local function getAssetType(assetId)
	if assetTypeCache[assetId] then
		return assetTypeCache[assetId]
	end
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfo(tonumber(assetId))
	end)
	if ok and info and info.AssetTypeId then
		local typeId = info.AssetTypeId
		local category = "unknown"
		if ASSET_TYPE_ANIMATION[typeId] then
			category = "animation"
		elseif ASSET_TYPE_SOUND[typeId] then
			category = "sound"
		elseif ASSET_TYPE_IMAGE[typeId] then
			category = "image"
		elseif ASSET_TYPE_MESH[typeId] then
			category = "mesh"
		end
		assetTypeCache[assetId] = category
		return category
	else
		warn("[AssetCollection] Could not resolve asset type for ID " .. tostring(assetId))
		assetTypeCache[assetId] = "unknown"
		return "unknown"
	end
end

local function extractIdsFromSource(source)
	local ids = {}
	for id in source:gmatch("rbxassetid://(%d+)") do
		ids[id] = true
	end
	for id in source:gmatch("https?://[%w%.]*roblox%.com/[Aa]sset/%?[Ii][Dd]=(%d+)") do
		ids[id] = true
	end
	for id in source:gmatch("rbxthumb://type=Asset&id=(%d+)") do
		ids[id] = true
	end
	return ids
end

local function scan()
	print("Total assets:", #Assets)
	local count = 0

	local animationData = {}
	local soundData = {}
	local imageData = {}
	local meshData = {}
	local scriptRefData = {}

	for _, obj in ipairs(Assets) do

		if obj:IsA("Animation") then
			table.insert(Animations, obj)
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and not seenAnimations[id] then
				seenAnimations[id] = true
				table.insert(animationData, {
					kind = "AnimationInstance",
					name = obj.Name,
					fullName = obj:GetFullName(),
					animationId = obj.AnimationId,
					assetId = id,
				})
			end

		elseif obj:IsA("Sound") then
			table.insert(Sounds, obj)
			local id = obj.SoundId:match("rbxassetid://(%d+)")
			if id and not seenSounds[id] then
				seenSounds[id] = true
				table.insert(soundData, {
					kind = "SoundInstance",
					name = obj.Name,
					fullName = obj:GetFullName(),
					soundId = obj.SoundId,
					assetId = id,
				})
			end

		elseif obj:IsA("Script") or obj:IsA("LocalScript") or obj:IsA("ModuleScript") then
			table.insert(Scripts, obj)
			local sourceOk, source = pcall(function() return obj.Source end)
			if sourceOk and source then
				local ids = extractIdsFromSource(source)
				for id in pairs(ids) do
					local assetType = getAssetType(id)

					table.insert(scriptRefData, {
						kind = "ScriptReference",
						script = obj:GetFullName(),
						scriptType = obj.ClassName,
						assetId = id,
						rawUrl = "rbxassetid://" .. id,
						resolvedType = assetType,
					})

					-- Add to the correct category based on MarketplaceService lookup
					if assetType == "animation" and not seenAnimations[id] then
						seenAnimations[id] = true
						table.insert(animationData, {
							kind = "ScriptReference",
							name = "rbxassetid://" .. id,
							fullName = obj:GetFullName(),
							animationId = "rbxassetid://" .. id,
							assetId = id,
						})
					elseif assetType == "sound" and not seenSounds[id] then
						seenSounds[id] = true
						table.insert(soundData, {
							kind = "ScriptReference",
							name = "rbxassetid://" .. id,
							fullName = obj:GetFullName(),
							soundId = "rbxassetid://" .. id,
							assetId = id,
						})
					elseif assetType == "image" and not seenImages[id] then
						seenImages[id] = true
						table.insert(imageData, {
							kind = "ScriptReference",
							name = "rbxassetid://" .. id,
							fullName = obj:GetFullName(),
							imageId = "rbxassetid://" .. id,
							assetId = id,
						})
					elseif assetType == "mesh" and not seenMeshes[id] then
						seenMeshes[id] = true
						table.insert(meshData, {
							kind = "ScriptReference",
							name = "rbxassetid://" .. id,
							fullName = obj:GetFullName(),
							meshId = "rbxassetid://" .. id,
							assetId = id,
						})
					end
				end
			else
				warn("[AssetCollection] Could not read source of " .. obj:GetFullName())
			end

		elseif obj:IsA("Decal") or obj:IsA("Texture") then
			table.insert(Images, obj)
			local tex = obj.Texture
			local id = tex:match("rbxassetid://(%d+)")
			if id and not seenImages[id] then
				seenImages[id] = true
				table.insert(imageData, {
					kind = obj.ClassName,
					name = obj.Name,
					fullName = obj:GetFullName(),
					property = "Texture",
					imageId = tex,
					assetId = id,
				})
			end

		elseif obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
			table.insert(Images, obj)
			local img = obj.Image
			local id = img:match("rbxassetid://(%d+)")
			if id and not seenImages[id] then
				seenImages[id] = true
				table.insert(imageData, {
					kind = obj.ClassName,
					name = obj.Name,
					fullName = obj:GetFullName(),
					property = "Image",
					imageId = img,
					assetId = id,
				})
			end

		elseif obj:IsA("MeshPart") then
			table.insert(Meshes, obj)
			local meshId = obj.MeshId ~= "" and obj.MeshId:match("rbxassetid://(%d+)") or nil
			local texId = obj.TextureID ~= "" and obj.TextureID:match("rbxassetid://(%d+)") or nil
			if meshId and not seenMeshes[meshId] then
				seenMeshes[meshId] = true
				table.insert(meshData, {
					kind = "MeshPart",
					name = obj.Name,
					fullName = obj:GetFullName(),
					meshId = obj.MeshId,
					assetId = meshId,
					textureId = obj.TextureID,
					textureAssetId = texId,
				})
			end

		elseif obj:IsA("SpecialMesh") then
			table.insert(Meshes, obj)
			local id = obj.MeshId ~= "" and obj.MeshId:match("rbxassetid://(%d+)") or nil
			if id and not seenMeshes[id] then
				seenMeshes[id] = true
				table.insert(meshData, {
					kind = "SpecialMesh",
					name = obj.Name,
					fullName = obj:GetFullName(),
					meshId = obj.MeshId,
					assetId = id,
				})
			end
		end

		count += 1
		if count >= BATCH_SIZE then
			count = 0
			task.wait()
		end
	end

	print(string.format(
		"Found %d Animations (%d unique), %d Sounds, %d Scripts (%d refs), %d Images, %d Meshes",
		#Animations, #animationData, #Sounds, #Scripts, #scriptRefData, #Images, #Meshes
	))

	local placeId = game.PlaceId
	local timestamp = os.time()

	if #animationData > 0 then
		sendToServer("/assets-animations", {
			timestamp = timestamp, placeId = placeId,
			assetCount = #animationData, assets = animationData
		})
	end

	if #soundData > 0 then
		sendToServer("/assets-sounds", {
			timestamp = timestamp, placeId = placeId,
			assetCount = #soundData, assets = soundData
		})
	end

	if #imageData > 0 then
		sendToServer("/assets-images", {
			timestamp = timestamp, placeId = placeId,
			assetCount = #imageData, assets = imageData
		})
	end

	if #meshData > 0 then
		sendToServer("/assets-meshes", {
			timestamp = timestamp, placeId = placeId,
			assetCount = #meshData, assets = meshData
		})
	end

	if #scriptRefData > 0 then
		sendToServer("/assets-script-refs", {
			timestamp = timestamp, placeId = placeId,
			assetCount = #scriptRefData, assets = scriptRefData
		})
	end

	print("[AssetCollection] All data sent.")
end

local function replaceIds(mappings)
	-- Build a lookup table: oldId -> newId
	local idMap = {}
	for _, m in ipairs(mappings) do
		local oldId = tostring(m.originalId)
		local newId = tostring(m.newId)
		idMap[oldId] = newId
	end

	local replaced = 0
	local descendants = game:GetDescendants()

	for _, obj in ipairs(descendants) do
		-- Animation instances
		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.AnimationId = "rbxassetid://" .. idMap[id]
				replaced += 1
				print("[Replace] Animation", obj:GetFullName(), id, "→", idMap[id])
			end

		-- Sound instances
		elseif obj:IsA("Sound") then
			local id = obj.SoundId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.SoundId = "rbxassetid://" .. idMap[id]
				replaced += 1
				print("[Replace] Sound", obj:GetFullName(), id, "→", idMap[id])
			end

		-- Decal / Texture
		elseif obj:IsA("Decal") or obj:IsA("Texture") then
			local id = obj.Texture:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.Texture = "rbxassetid://" .. idMap[id]
				replaced += 1
				print("[Replace] " .. obj.ClassName, obj:GetFullName(), id, "→", idMap[id])
			end

		-- ImageLabel / ImageButton
		elseif obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
			local id = obj.Image:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.Image = "rbxassetid://" .. idMap[id]
				replaced += 1
				print("[Replace] " .. obj.ClassName, obj:GetFullName(), id, "→", idMap[id])
			end

		-- MeshPart (MeshId + TextureID)
		elseif obj:IsA("MeshPart") then
			local meshId = obj.MeshId:match("rbxassetid://(%d+)")
			if meshId and idMap[meshId] then
				obj.MeshId = "rbxassetid://" .. idMap[meshId]
				replaced += 1
				print("[Replace] MeshPart.MeshId", obj:GetFullName(), meshId, "→", idMap[meshId])
			end
			local texId = obj.TextureID:match("rbxassetid://(%d+)")
			if texId and idMap[texId] then
				obj.TextureID = "rbxassetid://" .. idMap[texId]
				replaced += 1
				print("[Replace] MeshPart.TextureID", obj:GetFullName(), texId, "→", idMap[texId])
			end

		-- SpecialMesh
		elseif obj:IsA("SpecialMesh") then
			local id = obj.MeshId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.MeshId = "rbxassetid://" .. idMap[id]
				replaced += 1
				print("[Replace] SpecialMesh", obj:GetFullName(), id, "→", idMap[id])
			end

		-- Scripts: replace IDs in source code
		elseif obj:IsA("Script") or obj:IsA("LocalScript") or obj:IsA("ModuleScript") then
			local sourceOk, source = pcall(function() return obj.Source end)
			if sourceOk and source then
				local newSource = source
				for oldId, newId in pairs(idMap) do
					newSource = newSource:gsub("rbxassetid://" .. oldId, "rbxassetid://" .. newId)
					newSource = newSource:gsub("(roblox%.com/[Aa]sset/%?[Ii][Dd]=)" .. oldId, "%1" .. newId)
				end
				if newSource ~= source then
					local writeOk, writeErr = pcall(function()
						obj.Source = newSource
					end)
					if writeOk then
						replaced += 1
						print("[Replace] Script source", obj:GetFullName())
					else
						warn("[Replace] Could not write source of " .. obj:GetFullName() .. ": " .. tostring(writeErr))
					end
				end
			end
		end
	end

	print(string.format("[AssetCollection] Replacement complete: %d properties updated across %d mappings", replaced, #mappings))
end

local function init()
	Assets = {}
	Animations = {} Sounds = {} Scripts = {} Images = {} Meshes = {}
	seenAnimations = {} seenSounds = {} seenImages = {} seenMeshes = {}

	initialScan()
	task.spawn(scan)
end

local function startPolling()
	polling = true
	pollTask = task.spawn(function()
		while polling do
			-- Check for scan requests
			local ok, response = pcall(function()
				return HttpService:GetAsync(BASE_URL .. "/poll")
			end)
			if ok and response then
				local decodedOk, decoded = pcall(function()
					return HttpService:JSONDecode(response)
				end)
				if decodedOk and decoded and decoded.requestAssets then
					print("[AssetCollection] Server requested scan")
					init()
				end
			end

			-- Check for ID replacement mappings
			local replOk, replResponse = pcall(function()
				return HttpService:GetAsync(BASE_URL .. "/poll-replacements")
			end)
			if replOk and replResponse then
				local decOk, decData = pcall(function()
					return HttpService:JSONDecode(replResponse)
				end)
				if decOk and decData and decData.mappings and #decData.mappings > 0 then
					print("[AssetCollection] Received " .. #decData.mappings .. " replacement mappings")
					task.spawn(replaceIds, decData.mappings)
				end
			end

			task.wait(0.5)
		end
	end)
end

local function stopPolling()
	polling = false
	pollTask = nil
	print("[AssetCollection] Polling stopped")
end

--[[Button Events]]--
button.Click:Connect(function()
	button.Enabled = false
	local time = timeit(init)
	print("Scan initiated in " .. time .. "ms (running async)")
	button.Enabled = true
end)

pollButton.Click:Connect(function()
	if polling then
		stopPolling()
	else
		print("[AssetCollection] Polling started")
		startPolling()
	end
end)