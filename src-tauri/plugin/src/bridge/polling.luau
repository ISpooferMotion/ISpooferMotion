local function requestPollEndpoint(baseUrl: string, endpoint: string): (boolean, any, number?)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = baseUrl .. endpoint,
			Method = "GET",
			Headers = {
				["X-API-Key"] = API_KEY or "",
			},
		})
	end)

	if not ok or not response then
		return false, nil, nil
	end

	if response.StatusCode == 401 then
		return false, nil, 401
	end

	if not response.Success then
		return false, nil, response.StatusCode
	end

	local decodeOk, decoded = decodeJsonResponseBody(response)
	if not decodeOk then
		return false, nil, response.StatusCode
	end

	return true, decoded, response.StatusCode
end

local function fetchApiDumpProperties()
	local ok, decoded = getJson("/api-dump")
	if ok and type(decoded) == "table" then
		if decoded.assetProperties then
			ASSET_PROPERTIES = decoded.assetProperties
		end
		if decoded.stringScanProperties then
			STRING_SCAN_PROPERTIES = decoded.stringScanProperties
		end
		print("[ISpooferMotion] Downloaded Dynamic API Dump properties from Tauri backend.")
	else
		warn(
			"[ISpooferMotion] Failed to download Dynamic API Dump properties. Scan may be inaccurate."
		)
	end
end

local function startPolling(): ()
	if polling then
		return
	end

	polling = true

	task.spawn(function()
		while polling do
			if not BASE_URL or os.clock() - lastDiscovery >= 5 then
				local connected, changed = discoverServer()
				lastDiscovery = os.clock()
				if connected and changed and BASE_URL then
					print("[ISpooferMotion] Connected to " .. BASE_URL)
					task.spawn(fetchApiDumpProperties)
					task.spawn(scan)
				end
			end
			task.wait(BASE_URL and 1 or 2)
		end
	end)

	task.spawn(function()
		while polling do
			local baseUrl = BASE_URL
			if baseUrl then
				local pollOk, decoded, statusCode = requestPollEndpoint(baseUrl, "/poll")

				if statusCode == 401 then
					warn("[ISpooferMotion] Pairing expired; rediscovering local app")
					clearPairingState()
				elseif not pollOk then
					warn("[ISpooferMotion] Lost connection to " .. baseUrl)
					BASE_URL = nil
				elseif type(decoded) == "table" and decoded.requestAssets == true then
					if scanRunning then
						print("[ISpooferMotion] Scan already running")
					elseif patchRunning then
						print("[ISpooferMotion] Patch running; skipping scan request")
					else
						print("[ISpooferMotion] App requested scan")
						task.spawn(scan)
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)

	task.spawn(function()
		while polling do
			local baseUrl = BASE_URL
			if baseUrl then
				local patchOk, decoded, statusCode =
					requestPollEndpoint(baseUrl, "/poll-replacements")

				if statusCode == 401 then
					warn("[ISpooferMotion] Pairing expired; rediscovering local app")
					clearPairingState()
				elseif patchOk and type(decoded) == "table" then
					local patches = decoded.patches
					local mappings = decoded.mappings

					if type(patches) == "table" and #patches > 0 then
						if scanRunning then
							warn("[ISpooferMotion] Scan running; skipping patch batch")
						elseif patchRunning then
							warn("[ISpooferMotion] Patch batch already running")
						else
							print("[ISpooferMotion] Received " .. #patches .. " targeted patches")
							task.spawn(applyPatches, patches)
						end
					elseif type(mappings) == "table" and #mappings > 0 then
						warn(
							"[ISpooferMotion] No targeted patches were available. Run Scan before retrying replacement."
						)
					end
				end
			end

			task.wait(BASE_URL and 0.5 or 2)
		end
	end)
end
