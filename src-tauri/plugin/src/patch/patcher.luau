local BLOCKED_SET_PROPERTIES: { [string]: boolean } = {
	Parent = true,
	ClassName = true,
	Source = true,
}

local VALID_PATCH_ACTIONS: { [string]: boolean } = {
	setProperty = true,
	replaceEmotes = true,
	replaceAccessories = true,
	replaceTags = true,
	replaceAttribute = true,
	replaceScriptSource = true,
	replaceMeshPart = true,
}

local function normalizeAssetId(value: any): string?
	if value == nil then
		return nil
	end

	local str = string.lower(tostring(value))
	if str == "" then
		return nil
	end

	local assetId = string.match(str, "^rbxassetid://(%d+)$")
		or string.match(str, "^rbxasset://(%d+)$")
		or string.match(str, "^id=(%d+)$")
		or string.match(str, "^[?&]id=(%d+)$")
		or string.match(str, "[?&]id=(%d+)")
		or string.match(str, "roblox%.com/asset/%?id=(%d+)")
		or string.match(str, "roblox%.com/library/(%d+)")
		or string.match(str, "roblox%.com/catalog/(%d+)")
		or string.match(str, "create%.roblox%.com/marketplace/asset/(%d+)")
		or string.match(str, "^%d+$")

	if not assetId or #assetId > 20 then
		return nil
	end

	return assetId
end

local function toAssetUri(value: any): string?
	local assetId = normalizeAssetId(value)
	return if assetId then "rbxassetid://" .. assetId else nil
end

local function coercePropertyValue(obj: Instance, property: string, value: any): any
	local readOk, currentValue = pcall(function()
		return (obj :: any)[property]
	end)
	if not readOk then
		return value
	end

	if type(currentValue) == "number" then
		local assetId = normalizeAssetId(value)
		return if assetId then tonumber(assetId) else tonumber(value) or value
	end

	return value
end

local function validatePropertyName(property: any): (boolean, string?)
	if type(property) ~= "string" or property == "" or #property > 200 then
		return false, "Invalid patch property"
	end
	if string.find(property, "%z") then
		return false, "Invalid patch property"
	end
	return true, nil
end

local function normalizePatch(rawPatch: any): (Patch?, string?)
	if type(rawPatch) ~= "table" then
		return nil, "Patch must be a table"
	end
	if rawPatch.token == nil or tostring(rawPatch.token) == "" then
		return nil, "Patch is missing token"
	end
	if type(rawPatch.action) ~= "string" or rawPatch.action == "" then
		return nil, "Patch is missing action"
	end
	if not VALID_PATCH_ACTIONS[rawPatch.action] then
		return nil, "Unsupported patch action: " .. tostring(rawPatch.action)
	end

	local property = ""
	if rawPatch.property ~= nil then
		local okProperty, propertyErr = validatePropertyName(rawPatch.property)
		if not okProperty then
			return nil, propertyErr
		end
		property = rawPatch.property
	end

	if rawPatch.action == "setProperty" or rawPatch.action == "replaceAttribute" then
		local okProperty, propertyErr = validatePropertyName(property)
		if not okProperty then
			return nil, propertyErr
		end
	end

	return {
		token = tostring(rawPatch.token),
		fullName = if rawPatch.fullName ~= nil then tostring(rawPatch.fullName) else nil,
		action = rawPatch.action :: PatchAction,
		property = property,
		value = rawPatch.value,
		meshId = if rawPatch.meshId ~= nil then tostring(rawPatch.meshId) else nil,
		textureId = if rawPatch.textureId ~= nil then tostring(rawPatch.textureId) else nil,
	},
		nil
end

local function decodeJsonTable(value: any, label: string): (any?, string?)
	if type(value) ~= "string" then
		return nil, label .. " must be a JSON string"
	end
	if #value > 1000000 then
		return nil, label .. " JSON is too large"
	end

	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(value)
	end)
	if not ok or type(decoded) ~= "table" then
		return nil, "Invalid JSON " .. string.lower(label)
	end

	return decoded, nil
end

local function validateTags(decoded: any): (boolean, string?)
	if type(decoded) ~= "table" then
		return false, "Invalid JSON tags"
	end
	if #decoded > MAX_TAGS_PER_OBJECT then
		return false, "Too many tags"
	end

	local count = 0
	for key in pairs(decoded) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false, "Tags must be an array"
		end
		count += 1
	end
	if count ~= #decoded then
		return false, "Tags must be an array"
	end

	for _, tag in ipairs(decoded) do
		if type(tag) ~= "string" or tag == "" or #tag > MAX_TAG_BYTES then
			return false, "Invalid tag"
		end
	end

	return true, nil
end

local function applyPatch(patch: Patch): (boolean, string?)
	local obj = getRegisteredObject(patch.token)
	if not obj then
		return false, "Studio object no longer exists; scan again"
	end

	if patch.action == "setProperty" then
		if string.sub(patch.property, 1, 13) == "__Attribute__:" then
			local attr = string.sub(patch.property, 14)
			local okProperty, propertyErr = validatePropertyName(attr)
			if not okProperty then
				return false, propertyErr
			end
			local ok, err = pcall(function()
				obj:SetAttribute(attr, tonumber(patch.value) or patch.value)
			end)
			return ok, err
		end

		if BLOCKED_SET_PROPERTIES[patch.property] then
			return false, "Property cannot be set with setProperty"
		end

		local ok, err = pcall(function()
			(obj :: any)[patch.property] = coercePropertyValue(obj, patch.property, patch.value)
		end)
		return ok, err
	elseif patch.action == "replaceEmotes" then
		if not obj:IsA("HumanoidDescription") then
			return false, "replaceEmotes target is not a HumanoidDescription"
		end
		local decoded, decodeErr = decodeJsonTable(patch.value, "Emotes")
		if not decoded then
			return false, decodeErr
		end
		local ok, err = pcall(function()
			(obj :: any):SetEmotes(decoded)
		end)
		return ok, err
	elseif patch.action == "replaceAccessories" then
		if not obj:IsA("HumanoidDescription") then
			return false, "replaceAccessories target is not a HumanoidDescription"
		end
		local decoded, decodeErr = decodeJsonTable(patch.value, "Accessories")
		if not decoded then
			return false, decodeErr
		end
		local ok, err = pcall(function()
			(obj :: any):SetAccessories(decoded)
		end)
		return ok, err
	elseif patch.action == "replaceTags" then
		local decoded, decodeErr = decodeJsonTable(patch.value, "Tags")
		if not decoded then
			return false, decodeErr
		end
		local validTags, tagErr = validateTags(decoded)
		if not validTags then
			return false, tagErr
		end
		local ok, err = pcall(function()
			for _, oldTag in ipairs(CollectionService:GetTags(obj)) do
				if
					isAssetFormat(oldTag)
					or stringContainsAssetReference(oldTag)
					or nameLooksLikeAssetSlot(oldTag)
				then
					CollectionService:RemoveTag(obj, oldTag)
				end
			end
			for _, newTag in ipairs(decoded) do
				CollectionService:AddTag(obj, newTag)
			end
		end)
		return ok, err
	elseif patch.action == "replaceAttribute" then
		local okProperty, propertyErr = validatePropertyName(patch.property)
		if not okProperty then
			return false, propertyErr
		end
		local ok, err = pcall(function()
			obj:SetAttribute(patch.property, patch.value)
		end)
		return ok, err
	elseif patch.action == "replaceScriptSource" then
		if not obj:IsA("LuaSourceContainer") or obj.ClassName == "CoreScript" then
			return false, "Target is not a script"
		end

		local source = if type(patch.value) == "string"
			then patch.value
			else tostring(patch.value or "")
		if #source > MAX_SCRIPT_SOURCE_BYTES then
			return false, "Script source patch too large"
		end

		local ok, err
		if #source >= 200000 then
			ok, err = pcall(function()
				ScriptEditorService:UpdateSourceAsync(obj :: any, function()
					return source
				end)
			end)
		else
			ok, err = pcall(function()
				(obj :: any).Source = source
			end)
		end
		return ok, err
	elseif patch.action == "replaceMeshPart" then
		if not obj:IsA("MeshPart") then
			return false, "replaceMeshPart target is not a MeshPart"
		end

		local meshObj = obj :: MeshPart
		local targetMeshUri = if patch.meshId then toAssetUri(patch.meshId) else nil
		local targetTextureUri = if patch.textureId then toAssetUri(patch.textureId) else nil

		if patch.meshId and not targetMeshUri then
			return false, "Invalid meshId"
		end
		if patch.textureId and not targetTextureUri then
			return false, "Invalid textureId"
		end
		if not targetMeshUri and not targetTextureUri then
			return false, "replaceMeshPart requires meshId or textureId"
		end

		if not targetMeshUri then
			local ok, err = pcall(function()
				meshObj.TextureID = targetTextureUri :: string
			end)
			return ok, err
		end

		local oldParent = meshObj.Parent
		if not oldParent then
			return false, "MeshPart has no parent"
		end

		local createOk, createdPart = pcall(function()
			return AssetService:CreateMeshPartAsync(targetMeshUri, {
				CollisionFidelity = meshObj.CollisionFidelity,
				RenderFidelity = meshObj.RenderFidelity,
			})
		end)

		local newPart: BasePart
		if createOk and createdPart and createdPart:IsA("BasePart") then
			newPart = createdPart :: BasePart
		else
			local fallbackPart = Instance.new("Part")
			local specialMesh = Instance.new("SpecialMesh")
			specialMesh.MeshId = targetMeshUri
			specialMesh.Scale = Vector3.new(1, 1, 1)
			if targetTextureUri then
				specialMesh.TextureId = targetTextureUri
			end
			specialMesh.Parent = fallbackPart
			newPart = fallbackPart
		end

		local copyOk, copyErr = pcall(function()
			copyMeshPartPropertiesInto(meshObj, newPart, targetTextureUri)
			-- Explicitly re-apply color after CreateMeshPartAsync since the engine
			-- may reset it to default white during async mesh loading
			pcall(function()
				newPart.Color = meshObj.Color
				newPart.Material = meshObj.Material
				newPart.Transparency = meshObj.Transparency
				newPart.Reflectance = meshObj.Reflectance
			end)
		end)
		if not copyOk then
			pcall(function()
				newPart:Destroy()
			end)
			return false, copyErr
		end

		local parentOk, parentErr = pcall(function()
			newPart.Parent = oldParent
		end)
		if not parentOk or newPart.Parent ~= oldParent then
			pcall(function()
				newPart:Destroy()
			end)
			return false, parentErr or "Could not parent replacement MeshPart"
		end

		local moveOk, moveErr = pcall(function()
			moveMeshPartContentsInto(meshObj, newPart)
		end)
		if not moveOk then
			return false, moveErr
		end

		local destroyOk, destroyErr = pcall(function()
			meshObj:Destroy()
		end)
		if not destroyOk then
			return false, destroyErr
		end

		replaceRegisteredObject(patch.token, newPart)
		return true, nil
	end

	return false, "Unsupported patch action: " .. tostring(patch.action)
end

local function applyPatches(patches: any)
	if patchRunning then
		warn("[ISpooferMotion] Patch batch already running")
		return
	end
	if type(patches) ~= "table" then
		warn("[ISpooferMotion] Invalid patch batch")
		return
	end
	if #patches > MAX_PATCHES_PER_BATCH then
		warn(
			"[ISpooferMotion] Large patch batch: "
				.. tostring(#patches)
				.. " patches - processing in chunks"
		)
	end
	if scanRunning then
		warn("[ISpooferMotion] Scan already running; skipping patch batch")
		return
	end

	patchRunning = true
	local recording: any = nil
	local succeeded = 0
	local failed = 0

	pcall(function()
		recording = ChangeHistoryService:TryBeginRecording("ISpooferMotion Pre-Patch")
	end)

	local batchOk, batchErr = pcall(function()
		for index, rawPatch in ipairs(patches) do
			local ok, patchOk, patchErr = pcall(function()
				local patch, validationErr = normalizePatch(rawPatch)
				if not patch then
					return false, validationErr
				end
				return applyPatch(patch)
			end)

			if ok and patchOk then
				succeeded += 1
			else
				failed += 1
				local err = if ok then patchErr else patchOk
				local patchName = if type(rawPatch) == "table"
					then rawPatch.fullName or rawPatch.token
					else "unknown patch"
				warn(
					"[ISpooferMotion] Patch failed for "
						.. tostring(patchName)
						.. ": "
						.. tostring(err)
				)
			end

			if index % 50 == 0 then
				task.wait()
			end
		end
	end)

	if not batchOk then
		failed += 1
		warn("[ISpooferMotion] Patch batch failed: " .. tostring(batchErr))
	end

	if recording then
		pcall(function()
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		end)
	end

	patchRunning = false

	print(
		string.format(
			"[ISpooferMotion] Targeted replacement complete: %d patches applied, %d failed",
			succeeded,
			failed
		)
	)
	if succeeded > 0 then
		task.spawn(scan)
	end
end
