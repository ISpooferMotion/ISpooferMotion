local SCAN_CHUNK_BYTES: number = 1000000
local SCAN_MAX_TAGS_PER_OBJECT: number = 100
local SCAN_MAX_TAG_BYTES: number = 100

local ASSET_NAME_HINTS: { string } = {
	"asset",
	"anim",
	"animation",
	"sound",
	"audio",
	"music",
	"mesh",
	"image",
	"texture",
	"video",
	"decal",
	"icon",
	"content",
	"thumbnail",
}

local ASSET_ID_NAME_HINTS: { string } = {
	"id",
	"assetid",
	"animationid",
	"animid",
	"soundid",
	"audioid",
	"musicid",
	"meshid",
	"imageid",
	"textureid",
	"videoid",
	"decalid",
	"iconid",
	"contentid",
	"thumbnailid",
	"packageid",
	"templateid",
}

local function compactName(value: string): string
	return string.gsub(string.lower(value), "[%s_%-%./:]", "")
end

local function nameLooksLikeAssetSlot(value: string): boolean
	local compact = compactName(value)

	for _, hint in ipairs(ASSET_ID_NAME_HINTS) do
		if compact == hint or string.sub(compact, -#hint) == hint then
			return true
		end
	end

	for _, hint in ipairs(ASSET_NAME_HINTS) do
		if string.find(compact, hint, 1, true) then
			return true
		end
	end

	return false
end

local function scanAttributeRecords(records: { Record }, obj: Instance)
	local okAttrs, attrs = pcall(function()
		return obj:GetAttributes()
	end)

	if not okAttrs or type(attrs) ~= "table" then
		return
	end

	for key, value in pairs(attrs) do
		if type(key) == "string" then
			local keyLooksLikeAssetSlot = nameLooksLikeAssetSlot(key)
			local normalized = contentValueToString(value, keyLooksLikeAssetSlot)
			if normalized then
				if
					keyLooksLikeAssetSlot
					or isAssetFormat(value)
					or stringContainsAssetReference(normalized)
				then
					addRecord(
						records,
						obj,
						"__Attribute__:" .. key,
						normalized,
						keyLooksLikeAssetSlot
					)
				end
			end
		end
	end
end

local function validScannedTags(tags: any): boolean
	if type(tags) ~= "table" or #tags == 0 or #tags > SCAN_MAX_TAGS_PER_OBJECT then
		return false
	end

	for _, tag in ipairs(tags) do
		if type(tag) ~= "string" or tag == "" or #tag > SCAN_MAX_TAG_BYTES then
			return false
		end
	end

	return true
end

local function scanTagRecords(records: { Record }, obj: Instance)
	local okTags, tags = pcall(function()
		return CollectionService:GetTags(obj)
	end)

	if not okTags or not validScannedTags(tags) then
		return
	end

	local hasAssetTag = false
	for _, tag in ipairs(tags) do
		if
			isAssetFormat(tag)
			or stringContainsAssetReference(tag)
			or nameLooksLikeAssetSlot(tag)
		then
			hasAssetTag = true
			break
		end
	end

	if not hasAssetTag then
		return
	end

	local okJson, jsonStr = pcall(function()
		return HttpService:JSONEncode(tags)
	end)

	if okJson and jsonStr then
		addRecord(records, obj, "__Tags__", jsonStr, false)
	end
end

local function scanValueObjectRecord(records: { Record }, obj: Instance)
	if not (obj:IsA("StringValue") or obj:IsA("IntValue") or obj:IsA("NumberValue")) then
		return
	end

	local ok, val = pcall(function()
		return (obj :: any).Value
	end)

	if not ok then
		return
	end

	local nameLooksLikeAsset = nameLooksLikeAssetSlot(obj.Name)
	local normalized = contentValueToString(val, nameLooksLikeAsset)
	if not normalized then
		return
	end

	local shouldCapture = nameLooksLikeAsset
		or isAssetFormat(val)
		or stringContainsAssetReference(normalized)

	if shouldCapture then
		addRecord(records, obj, "Value", normalized, nameLooksLikeAsset)
	end
end

local function scanScriptSourceRecord(records: { Record }, obj: Instance)
	if not obj:IsA("LuaSourceContainer") or obj.ClassName == "CoreScript" then
		return
	end

	local sourceOk, source = pcall(function()
		return (obj :: any).Source
	end)

	if not sourceOk then
		local fullName = "Unknown"
		pcall(function()
			fullName = obj:GetFullName()
		end)
		warn("[ISpooferMotion] Could not read source of " .. fullName)
		return
	end

	if source and source ~= "" then
		if #source <= MAX_SCRIPT_SOURCE_BYTES then
			addRecord(records, obj, "Source", source, false)
		else
			local fullName = "Unknown"
			pcall(function()
				fullName = obj:GetFullName()
			end)
			warn("[ISpooferMotion] Skipping oversized script source: " .. fullName)
		end
	end
end

local FLUSH_MAX_RETRIES: number = 3
local FLUSH_RETRY_WAIT: number = 1.5

local function flushScanRecordsOrError(records: { Record })
	for attempt = 1, FLUSH_MAX_RETRIES do
		if flushRecords(records) then
			return
		end
		if attempt < FLUSH_MAX_RETRIES then
			warn(
				string.format(
					"[ISpooferMotion] Scan chunk send failed (attempt %d/%d), retrying...",
					attempt,
					FLUSH_MAX_RETRIES
				)
			)
			task.wait(FLUSH_RETRY_WAIT)
		end
	end
	error("Could not send Studio scan records after " .. FLUSH_MAX_RETRIES .. " attempts")
end

local function processScannedObject(records: { Record }, obj: Instance)
	scanAttributeRecords(records, obj)
	scanTagRecords(records, obj)
	scanSpecialInstanceAssets(records, obj)

	local scannedProps: { [string]: boolean } = {}
	local assetProps = ASSET_PROPERTIES[obj.ClassName]
	if assetProps then
		for _, prop in ipairs(assetProps) do
			scannedProps[prop] = true
			captureProperty(records, obj, prop)
		end
	end

	scanBundledStringProperties(records, obj, scannedProps)
	scanValueObjectRecord(records, obj)
	scanScriptSourceRecord(records, obj)
	scanEmbeddedStringAssets(records, obj)
end

local function scanAssets(): ()
	local bundledAssetClasses = countBundledClasses(ASSET_PROPERTIES)
	local bundledStringClasses = countBundledClasses(STRING_SCAN_PROPERTIES)

	if bundledAssetClasses == 0 then
		warn("[ISpooferMotion] Bundled API property tables are empty.")
	else
		print(
			string.format(
				"[ISpooferMotion] Using bundled API dump (%d asset classes, %d string-scan classes)",
				bundledAssetClasses,
				bundledStringClasses
			)
		)
	end

	local placeId = 0
	pcall(function()
		placeId = game.PlaceId
	end)

	if not postJson("/scan-start", { placeId = placeId }) then
		pcall(function()
			postJson("/scan-abort", {})
		end)
		return
	end

	resetObjectRegistry()
	resetScanRecordState()

	local records: { Record } = {}
	local captured = 0
	local processed = 0
	local lastYieldTime = os.clock()
	local lastProgressTime = 0
	local totalObjects = 0

	local function scanRecursive(obj: Instance, currentService: string)
		processed += 1
		totalObjects += 1
		processScannedObject(records, obj)

		if #records >= SEND_CHUNK_SIZE or getPendingRecordBytes() >= SCAN_CHUNK_BYTES then
			captured += #records
			flushScanRecordsOrError(records)
		end

		local now = os.clock()
		if now - lastProgressTime >= 0.25 then
			pcall(function()
				postJson("/scan-progress", {
					scanning = true,
					current_service = currentService,
					scanned = processed,
					total = totalObjects,
				})
			end)
			lastProgressTime = now
		end

		if now - lastYieldTime >= 0.08 then
			task.wait(0)
			lastYieldTime = os.clock()
		end

		local ok, children = pcall(function()
			return obj:GetChildren()
		end)
		if ok and type(children) == "table" then
			for _, child in ipairs(children) do
				scanRecursive(child, currentService)
			end
		end
	end

	for _, serviceName in ipairs(SERVICES_TO_SCAN) do
		local ok, service = pcall(function()
			return game:GetService(serviceName)
		end)
		if ok and service then
			scanRecursive(service, serviceName)
		end
	end

	captured += #records
	flushScanRecordsOrError(records)

	local completeOk, response = postJson("/scan-complete", {})
	if not completeOk then
		error("Could not finalize Studio scan")
	end

	local totals = response and response.totals or {}

	if response and response.recordsTruncated then
		local truncatedCount = tonumber(response.truncatedCount) or 0
		local keepCount = tonumber(response.keptCount) or 0
		if truncatedCount > 0 then
			warn(
				string.format(
					"[ISpooferMotion] Scan hit the server record limit: %d records kept, %d dropped. Very large places may miss some assets - try splitting into separate places or filtering to specific services.",
					keepCount,
					truncatedCount
				)
			)
		else
			warn(
				"[ISpooferMotion] Scan hit the server record limit - some assets may be missing. Try splitting very large places or contact support."
			)
		end
	end

	print(
		string.format(
			"[ISpooferMotion] Scan complete: %d records captured, %d animations, %d sounds, %d images, %d meshes, %d script refs",
			captured,
			tonumber(totals.animations) or 0,
			tonumber(totals.sounds) or 0,
			tonumber(totals.images) or 0,
			tonumber(totals.meshes) or 0,
			tonumber(totals.scriptRefs) or 0
		)
	)
end

local function scan(): ()
	if scanRunning then
		print("[ISpooferMotion] Scan already running")
		return
	end

	if patchRunning then
		print("[ISpooferMotion] Patch running; skipping scan")
		return
	end

	scanRunning = true
	local ok, err = pcall(scanAssets)
	scanRunning = false

	if not ok then
		resetObjectRegistry()
		resetScanRecordState()
		pcall(function()
			postJson("/scan-abort", {})
		end)
		warn("[ISpooferMotion] Scan failed: " .. tostring(err))
	end
end
