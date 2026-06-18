local function responseLooksLikeAppHealth(decoded: any): boolean
	return type(decoded) == "table" and decoded.app == "ISpooferMotion"
end

local function healthAllowsPairing(decoded: any): boolean
	if type(decoded) ~= "table" then
		return false
	end

	return decoded.pairingReady == true
		or decoded.allowStudioPairing == true
		or decoded.waitingForStudioPairing == true
end

local function pollWithKey(url: string, key: string): boolean
	if key == "" then
		return false
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = url .. "/poll",
			Method = "GET",
			Headers = {
				["X-API-Key"] = key,
			},
		})
	end)

	return ok and response ~= nil and response.Success == true
end

local function requestDiscoveredKey(url: string): string?
	local keyOk, keyResponse = pcall(function()
		return HttpService:RequestAsync({
			Url = url .. "/discover-key",
			Method = "GET",
			Headers = {
				["X-Studio-Bridge"] = "1",
			},
		})
	end)

	if not keyOk or not keyResponse or not keyResponse.Success then
		return nil
	end

	local decodeOk, decoded = decodeJsonResponseBody(keyResponse)
	if not decodeOk or type(decoded) ~= "table" then
		return nil
	end

	local key = decoded.key
	if type(key) ~= "string" or #key < 16 or #key > 512 then
		return nil
	end

	return key
end

local function confirmPairing(url: string, key: string)
	pcall(function()
		HttpService:RequestAsync({
			Url = url .. "/confirm-pairing",
			Method = "GET",
			Headers = {
				["X-API-Key"] = key,
				["X-Studio-Bridge"] = "1",
			},
		})
	end)
end

local function discoverServer(): (boolean, boolean)
	local newestUrl = nil
	local newestStartedAt = -1
	local pending = 0
	local results: { { url: string, startedAt: number, health: any } } = {}

	local hosts = { "127.0.0.1", "localhost", "127.0.0.1.nip.io" }

	for port = PORT_START, PORT_END do
		for _, host in ipairs(hosts) do
			pending += 1
			local url = "http://" .. host .. ":" .. port

			task.spawn(function()
				local taskOk = pcall(function()
					local ok, response = pcall(function()
						return HttpService:RequestAsync({
							Url = url .. "/health",
							Method = "GET",
						})
					end)

					if ok and response and response.Success then
						local decodedOk, decoded = decodeJsonResponseBody(response)
						if decodedOk and responseLooksLikeAppHealth(decoded) then
							local startedAt = tonumber(decoded.startedAt) or 0
							table.insert(results, {
								url = url,
								startedAt = startedAt,
								health = decoded,
							})
						end
					end
				end)

				pending -= 1
			end)
		end
	end

	local timeout = os.clock() + 5
	while pending > 0 and os.clock() < timeout do
		task.wait(0.05)
	end

	local selectedHealth = nil
	for _, result in ipairs(results) do
		if result.startedAt > newestStartedAt then
			newestUrl = result.url
			newestStartedAt = result.startedAt
			selectedHealth = result.health
		end
	end

	if not newestUrl then
		BASE_URL = nil
		return false, false
	end

	if not API_KEY or API_KEY == "" then
		API_KEY = plugin:GetSetting(API_KEY_SETTING)
	end

	if type(API_KEY) == "string" and pollWithKey(newestUrl, API_KEY) then
		local changed = BASE_URL ~= newestUrl
		BASE_URL = newestUrl
		return true, changed
	end

	if not healthAllowsPairing(selectedHealth) then
		return false, false
	end

	local discoveredKey = requestDiscoveredKey(newestUrl)
	if not discoveredKey then
		warn("[ISpooferMotion] Studio pairing key was not available")
		return false, false
	end

	if not pollWithKey(newestUrl, discoveredKey) then
		warn("[ISpooferMotion] Discovered pairing key was rejected")
		return false, false
	end

	API_KEY = discoveredKey
	plugin:SetSetting(API_KEY_SETTING, discoveredKey)
	confirmPairing(newestUrl, discoveredKey)

	local changed = BASE_URL ~= newestUrl
	BASE_URL = newestUrl
	return true, changed
end
