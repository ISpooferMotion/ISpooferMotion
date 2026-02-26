-- =====================================
-- ISpooferMotion – OPTIMIZED Asset Streaming
-- =====================================
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService = game:GetService("RunService")

-- Prevent plugin from running in play mode
if not RunService:IsEdit() then
	warn("[ISpooferMotion] Plugin disabled during play mode")
	return
end

-- =====================================
-- PLUGIN CONFIGURATION & UI
-- =====================================
local plugin = plugin or PluginManager():CreatePlugin()
local toolbar = plugin:CreateToolbar("ISpooferMotion")
local button = toolbar:CreateButton("Settings", "Configure ISpooferMotion connection", "rbxassetid://137844667859456")

-- State variables
local currentPort = 3100
local connectionEnabled = true
local pollTasks = {}

-- Scan settings
local scanSpeed = "Normal" -- "Fast", "Normal", "Slow", "Ultra Slow"
local showProgressReports = true
local disableScanTimeout = false

-- Persistent processed IDs to avoid re-scanning same assets
local processedSoundIds = {}
local processedAnimationIds = {}
local processedImageIds = {}

-- Create DockWidget UI
local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,   -- Initially enabled
	false,   -- Don't override previous enabled state
	300,     -- Default width
	400,     -- Default height (increased for new settings)
	250,     -- Min width
	350      -- Min height (increased for new settings)
)

local widget = plugin:CreateDockWidgetPluginGui("ISpooferMotionSettings", widgetInfo)
widget.Title = "ISpooferMotion Settings"

-- Create UI elements
local frame = Instance.new("Frame")
frame.Size = UDim2.new(1, 0, 1, 0)
frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
frame.BorderSizePixel = 0
frame.Parent = widget

local titleLabel = Instance.new("TextLabel")
titleLabel.Size = UDim2.new(1, -20, 0, 30)
titleLabel.Position = UDim2.new(0, 10, 0, 10)
titleLabel.BackgroundTransparency = 1
titleLabel.Text = "ISpooferMotion Control"
titleLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
titleLabel.Font = Enum.Font.SourceSansBold
titleLabel.TextSize = 18
titleLabel.TextXAlignment = Enum.TextXAlignment.Left
titleLabel.Parent = frame

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.new(1, -20, 0, 20)
statusLabel.Position = UDim2.new(0, 10, 0, 45)
statusLabel.BackgroundTransparency = 1
statusLabel.Text = "Status: Connected"
statusLabel.TextColor3 = Color3.fromRGB(16, 185, 129)
statusLabel.Font = Enum.Font.SourceSans
statusLabel.TextSize = 14
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.Parent = frame

local toggleButton = Instance.new("TextButton")
toggleButton.Size = UDim2.new(1, -20, 0, 35)
toggleButton.Position = UDim2.new(0, 10, 0, 75)
toggleButton.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
toggleButton.BorderSizePixel = 0
toggleButton.Text = "Stop Connection"
toggleButton.TextColor3 = Color3.fromRGB(255, 255, 255)
toggleButton.Font = Enum.Font.SourceSansBold
toggleButton.TextSize = 16
toggleButton.Parent = frame

local portLabel = Instance.new("TextLabel")
portLabel.Size = UDim2.new(1, -20, 0, 20)
portLabel.Position = UDim2.new(0, 10, 0, 120)
portLabel.BackgroundTransparency = 1
portLabel.Text = "Port:"
portLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
portLabel.Font = Enum.Font.SourceSans
portLabel.TextSize = 14
portLabel.TextXAlignment = Enum.TextXAlignment.Left
portLabel.Parent = frame

local portInput = Instance.new("TextBox")
portInput.Size = UDim2.new(1, -20, 0, 30)
portInput.Position = UDim2.new(0, 10, 0, 145)
portInput.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
portInput.BorderSizePixel = 1
portInput.BorderColor3 = Color3.fromRGB(70, 70, 70)
portInput.Text = tostring(currentPort)
portInput.TextColor3 = Color3.fromRGB(255, 255, 255)
portInput.Font = Enum.Font.SourceSans
portInput.TextSize = 14
portInput.PlaceholderText = "3100"
portInput.ClearTextOnFocus = false
portInput.Parent = frame

-- Scan Speed Label
local scanSpeedLabel = Instance.new("TextLabel")
scanSpeedLabel.Size = UDim2.new(1, -20, 0, 20)
scanSpeedLabel.Position = UDim2.new(0, 10, 0, 185)
scanSpeedLabel.BackgroundTransparency = 1
scanSpeedLabel.Text = "Scan Speed:"
scanSpeedLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
scanSpeedLabel.Font = Enum.Font.SourceSans
scanSpeedLabel.TextSize = 14
scanSpeedLabel.TextXAlignment = Enum.TextXAlignment.Left
scanSpeedLabel.Parent = frame

-- Scan Speed Dropdown
local scanSpeedDropdown = Instance.new("TextButton")
scanSpeedDropdown.Size = UDim2.new(1, -20, 0, 30)
scanSpeedDropdown.Position = UDim2.new(0, 10, 0, 210)
scanSpeedDropdown.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
scanSpeedDropdown.BorderSizePixel = 1
scanSpeedDropdown.BorderColor3 = Color3.fromRGB(70, 70, 70)
scanSpeedDropdown.Text = "⚡ " .. scanSpeed .. " ▼"
scanSpeedDropdown.TextColor3 = Color3.fromRGB(255, 255, 255)
scanSpeedDropdown.Font = Enum.Font.SourceSans
scanSpeedDropdown.TextSize = 14
scanSpeedDropdown.Parent = frame

-- Progress Reports Checkbox
local progressCheckbox = Instance.new("TextButton")
progressCheckbox.Size = UDim2.new(1, -20, 0, 30)
progressCheckbox.Position = UDim2.new(0, 10, 0, 250)
progressCheckbox.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
progressCheckbox.BorderSizePixel = 1
progressCheckbox.BorderColor3 = Color3.fromRGB(70, 70, 70)
progressCheckbox.Text = "✓ Show Progress Reports"
progressCheckbox.TextColor3 = Color3.fromRGB(16, 185, 129)
progressCheckbox.Font = Enum.Font.SourceSans
progressCheckbox.TextSize = 14
progressCheckbox.Parent = frame

-- Timeout Checkbox
local timeoutCheckbox = Instance.new("TextButton")
timeoutCheckbox.Size = UDim2.new(1, -20, 0, 30)
timeoutCheckbox.Position = UDim2.new(0, 10, 0, 290)
timeoutCheckbox.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
timeoutCheckbox.BorderSizePixel = 1
timeoutCheckbox.BorderColor3 = Color3.fromRGB(70, 70, 70)
timeoutCheckbox.Text = "⏱ Disable Scan Timeout"
timeoutCheckbox.TextColor3 = Color3.fromRGB(200, 200, 200)
timeoutCheckbox.Font = Enum.Font.SourceSans
timeoutCheckbox.TextSize = 14
timeoutCheckbox.Parent = frame

-- Info Label
local infoLabel = Instance.new("TextLabel")
infoLabel.Size = UDim2.new(1, -20, 0, 60)
infoLabel.Position = UDim2.new(0, 10, 0, 330)
infoLabel.BackgroundTransparency = 1
infoLabel.Text = "ℹ️ For big games, use Slow/Ultra Slow to prevent Studio from freezing."
infoLabel.TextColor3 = Color3.fromRGB(150, 150, 150)
infoLabel.Font = Enum.Font.SourceSans
infoLabel.TextSize = 12
infoLabel.TextXAlignment = Enum.TextXAlignment.Left
infoLabel.TextYAlignment = Enum.TextYAlignment.Top
infoLabel.TextWrapped = true
infoLabel.Parent = frame

-- Dynamic URL building function
local function buildUrls()
	local baseUrl = "http://localhost:" .. currentPort
	return {
		pollSounds = baseUrl .. "/poll-sounds",
		pollAnimations = baseUrl .. "/poll-animations",
		pollImages = baseUrl .. "/poll-images",
		pollReplacements = baseUrl .. "/poll-replacements",
		sendSounds = baseUrl .. "/assets-sounds",
		sendAnimations = baseUrl .. "/assets-animations",
		sendImages = baseUrl .. "/assets-images",
		soundsComplete = baseUrl .. "/sounds-complete",
		animationsComplete = baseUrl .. "/animations-complete",
		imagesComplete = baseUrl .. "/images-complete",
	}
end

local urls = buildUrls()

-- Resolve current place ownership so we can skip assets already owned by the place owner/group
local PLACE_CREATOR_ID = game.CreatorId
local PLACE_CREATOR_TYPE = tostring(game.CreatorType)
local SKIP_OWNED_CHECK = true

-- Test connection to localhost server
local function testConnection()
	-- First check if HttpService is enabled
	local httpEnabled = pcall(function()
		HttpService:GetAsync("http://localhost:" .. currentPort)
	end)

	if not httpEnabled then
		warn("[ISpooferMotion] ❌ HttpService is NOT enabled!")
		warn("[ISpooferMotion] To enable: Home tab > Game Settings > Security > Enable 'Allow HTTP Requests'")
		return false
	end

	print("[ISpooferMotion] Testing connection to localhost:" .. currentPort .. "...")
	local testUrl = string.format("http://localhost:%d/poll-sounds", currentPort)

	local ok, response = pcall(function()
		return HttpService:GetAsync(testUrl)
	end)

	if ok then
		print("[ISpooferMotion] ✓ Successfully connected to app!")
		return true
	else
		warn("[ISpooferMotion] ❌ Connection test FAILED: " .. tostring(response))
		warn("[ISpooferMotion] Troubleshooting:")
		warn("  1. Is the ISpooferMotion desktop app running?")
		warn("  2. Correct port? Currently set to: " .. currentPort)
		warn("  3. Firewall blocking localhost connections?")
		return false
	end
end

-- UI Event Handlers
button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

toggleButton.MouseButton1Click:Connect(function()
	connectionEnabled = not connectionEnabled
	if connectionEnabled then
		statusLabel.Text = "Status: Connected"
		statusLabel.TextColor3 = Color3.fromRGB(16, 185, 129)
		toggleButton.Text = "Stop Connection"
		toggleButton.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
		-- Clear processed IDs when reconnecting to allow fresh scans
		processedSoundIds = {}
		processedAnimationIds = {}
		processedImageIds = {}
		print("[ISpooferMotion] Cache cleared - fresh scan on next request")
		print("[ISpooferMotion] Connection enabled on port " .. currentPort)

		-- Test connection immediately
		testConnection()
	else
		toggleButton.Text = "Start Connection"
		toggleButton.BackgroundColor3 = Color3.fromRGB(16, 185, 129)
		statusLabel.Text = "Status: Disconnected"
		statusLabel.TextColor3 = Color3.fromRGB(239, 68, 68)
		print("[ISpooferMotion] Connection disabled")
		-- Cancel all active polling tasks
		for _, task in pairs(pollTasks) do
			task.cancel()
		end
		pollTasks = {}
	end
end)

portInput.FocusLost:Connect(function(enterPressed)
	local newPort = tonumber(portInput.Text)
	if newPort and newPort >= 1024 and newPort <= 65535 then
		currentPort = newPort
		urls = buildUrls()
		print("[ISpooferMotion] Port changed to " .. currentPort)
		portInput.Text = tostring(currentPort)
		-- Restart polling if connected
		if connectionEnabled then
			print("[ISpooferMotion] Restarting connection on new port...")
			-- Cancel old tasks
			for _, task in pairs(pollTasks) do
				task.cancel()
			end
			pollTasks = {}
		end
	else
		warn("[ISpooferMotion] Invalid port number. Must be between 1024-65535")
		portInput.Text = tostring(currentPort)
	end
end)

-- Scan Speed Dropdown Event
local scanSpeedOptions = {"Fast", "Normal", "Slow", "Ultra Slow"}
local scanSpeedIndex = 2 -- Default to Normal
scanSpeedDropdown.MouseButton1Click:Connect(function()
	scanSpeedIndex = (scanSpeedIndex % #scanSpeedOptions) + 1
	scanSpeed = scanSpeedOptions[scanSpeedIndex]
	scanSpeedDropdown.Text = "⚡ " .. scanSpeed .. " ▼"
	print("[ISpooferMotion] Scan speed set to: " .. scanSpeed)
end)

-- Progress Reports Checkbox Event
progressCheckbox.MouseButton1Click:Connect(function()
	showProgressReports = not showProgressReports
	if showProgressReports then
		progressCheckbox.Text = "✓ Show Progress Reports"
		progressCheckbox.TextColor3 = Color3.fromRGB(16, 185, 129)
	else
		progressCheckbox.Text = "✗ Show Progress Reports"
		progressCheckbox.TextColor3 = Color3.fromRGB(200, 200, 200)
	end
	print("[ISpooferMotion] Progress reports: " .. (showProgressReports and "Enabled" or "Disabled"))
end)

-- Timeout Checkbox Event
timeoutCheckbox.MouseButton1Click:Connect(function()
	disableScanTimeout = not disableScanTimeout
	if disableScanTimeout then
		timeoutCheckbox.Text = "✓ Disable Scan Timeout"
		timeoutCheckbox.TextColor3 = Color3.fromRGB(16, 185, 129)
		print("[ISpooferMotion] Scan timeout disabled - will scan until complete")
	else
		timeoutCheckbox.Text = "⏱ Disable Scan Timeout"
		timeoutCheckbox.TextColor3 = Color3.fromRGB(200, 200, 200)
		print("[ISpooferMotion] Scan timeout enabled")
	end
end)

print("[ISpooferMotion] Plugin loaded (OPTIMIZED), ready on port " .. currentPort)

-- Test initial connection
task.delay(0.5, function()
	if connectionEnabled then
		testConnection()
	end
end)

-- Cache to avoid duplicate GetProductInfo calls
local infoCache = {}
local infoFailCache = {}
local INFO_FAIL_TTL_SEC = 30

-- Get scan delay based on speed setting
local function getScanDelay()
	if scanSpeed == "Fast" then
		return 0 -- No delay
	elseif scanSpeed == "Normal" then
		return 0.001 -- Minimal delay
	elseif scanSpeed == "Slow" then
		return 0.01 -- 10ms delay every iteration
	elseif scanSpeed == "Ultra Slow" then
		return 0.05 -- 50ms delay every iteration
	end
	return 0.001 -- Default to normal
end

-- Get check interval based on scan speed (how often to yield)
local function getCheckInterval()
	if scanSpeed == "Fast" then
		return 1000 -- Check every 1000 objects
	elseif scanSpeed == "Normal" then
		return 500 -- Check every 500 objects
	elseif scanSpeed == "Slow" then
		return 100 -- Check every 100 objects
	elseif scanSpeed == "Ultra Slow" then
		return 50 -- Check every 50 objects
	end
	return 500 -- Default
end

-- Report progress percentage
local function reportProgress(label, scanned, total, found)
	if not showProgressReports then return end

	local percent = math.floor((scanned / total) * 100)
	-- Report every 10%
	if percent % 10 == 0 and percent > 0 then
		print(string.format("[ISpooferMotion] %s: %d%% complete (scanned %d/%d, found %d assets)", 
			label, percent, scanned, total, found))
	end
end

local function logScanProgress(label, totalDesc, found, skippedOwned, skippedPublic, infoMissing)
	print(string.format(
		"[ISpooferMotion] %s progress: scanned=%d, found=%d, skippedOwned=%d, skippedPublic=%d, infoMissing=%d",
		label,
		totalDesc,
		found,
		skippedOwned,
		skippedPublic,
		infoMissing
		))
end

-- Determine if an asset is owned by the place owner/group
local function isOwnedByPlaceCreator(info)
	if not info or not info.Creator then
		return false
	end

	local creatorId = info.Creator.Id
	local creatorType = tostring(info.Creator.CreatorType or "")

	-- Group-owned place: skip assets owned by the same group
	if PLACE_CREATOR_TYPE == "Group" then
		return creatorType == "Group" and creatorId == PLACE_CREATOR_ID
	end

	-- User-owned place: skip assets owned by the same user (non-group)
	return creatorType ~= "Group" and creatorId == PLACE_CREATOR_ID
end

-- Determine if an asset is publicly accessible (no need to re-upload)
local function isPublicAccessible(info)
	if not info then
		return false
	end

	-- CopyingAllowed / PublicDomain covers most free-to-use assets; zero-priced sale as fallback
	if info.IsCopyingAllowed == true then return true end
	if info.IsPublicDomain == true then return true end
	if info.IsForSale == true and info.PriceInRobux == 0 then return true end

	return false
end

local function getSkipReason(info)
	if not info then
		return nil
	end
	if SKIP_OWNED_CHECK and isOwnedByPlaceCreator(info) then
		return "owned"
	end
	if isPublicAccessible(info) then
		return "public"
	end
	return nil
end

local function shouldSkipAsset(info)
	return getSkipReason(info) ~= nil
end

local function getProductInfo(assetId)
	if infoCache[assetId] then
		return infoCache[assetId]
	end

	local lastFail = infoFailCache[assetId]
	if lastFail and (os.time() - lastFail) < INFO_FAIL_TTL_SEC then
		return nil
	end

	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfo(assetId)
	end)

	if ok and info then
		infoCache[assetId] = info
		infoFailCache[assetId] = nil
		return info
	end

	infoFailCache[assetId] = os.time()
	return nil
end

local function sendBatch(batch, url, label)
	if not connectionEnabled then return end
	if #batch == 0 then return end
	local payload = {
		timestamp = os.time(),
		placeId = game.PlaceId,
		assetCount = #batch,
		assets = batch,
	}
	local ok, err = pcall(function()
		HttpService:PostAsync(url, HttpService:JSONEncode(payload), Enum.HttpContentType.ApplicationJson)
	end)
	if ok then
		print(string.format("[ISpooferMotion] Sent batch of %d %s", #batch, label))
	else
		warn("[ISpooferMotion] Failed to send batch:", err)
	end
end

local function signalComplete(url, label)
	if not connectionEnabled then return end
	local ok, err = pcall(function()
		HttpService:PostAsync(url, "{}", Enum.HttpContentType.ApplicationJson)
	end)
	if ok then
		print(string.format("[ISpooferMotion] Signaled %s scan complete", label))
	else
		warn("[ISpooferMotion] Failed to signal completion:", err)
	end
end

-- OPTIMIZED: Scan without GetProductInfo first, then batch fetch info
local function scanSoundsIncremental()
	local batch = {}
	local batchSize = 1 -- 10x larger batches
	local spooferOutput = game:GetService("ServerStorage"):FindFirstChild("Spoofer-Output")

	local startClock = os.clock()
	local scanned = 0
	local skippedOwned = 0
	local skippedPublic = 0
	local infoMissing = 0
	local scriptMatches = 0
	local lastProgressPercent = 0

	-- Clear processed IDs for fresh scan
	processedSoundIds = {}

	print("[ISpooferMotion] Starting sound scan (streaming mode)...")
	print(string.format("[ISpooferMotion] Scan speed: %s | Progress reports: %s | Timeout: %s", 
		scanSpeed, 
		showProgressReports and "Enabled" or "Disabled",
		disableScanTimeout and "Disabled" or "Enabled"))
	print("[ISpooferMotion] Scanning: game descendants, excluding ServerStorage/Spoofer-Output")

	-- Get all descendants first to calculate total
	local allDescendants = game:GetDescendants()
	local totalObjects = #allDescendants
	print(string.format("[ISpooferMotion] Total objects to scan: %d", totalObjects))

	-- Stream batches as they fill
	local currentBatch = {}
	local totalFound = 0
	local checkInterval = getCheckInterval()
	local scanDelay = getScanDelay()

	local function flushBatch()
		if #currentBatch > 0 then
			sendBatch(currentBatch, urls.sendSounds, "sounds")
			currentBatch = {}
		end
	end

	local function addAsset(asset)
		table.insert(currentBatch, asset)
		totalFound = totalFound + 1
		if #currentBatch >= batchSize then
			flushBatch()
		end
	end

	for _, obj in pairs(allDescendants) do
		scanned = scanned + 1

		-- Progress reporting
		if showProgressReports then
			local currentPercent = math.floor((scanned / totalObjects) * 100)
			if currentPercent >= lastProgressPercent + 10 and currentPercent % 10 == 0 then
				print(string.format("[ISpooferMotion] Sounds: %d%% complete (scanned %d/%d, found %d assets)", 
					currentPercent, scanned, totalObjects, totalFound))
				lastProgressPercent = currentPercent
			end
		end

		-- Yield control based on scan speed
		if scanned % checkInterval == 0 then
			task.wait(scanDelay)
		end

		if scanned % 5000 == 0 then
			logScanProgress("Sounds", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
		end

		if not obj:IsDescendantOf(spooferOutput or Instance.new("Folder")) then
			if obj:IsA("Sound") then
				local id = obj.SoundId:match("rbxassetid://(%d+)")
				if id and not processedSoundIds[id] then
					local info = getProductInfo(tonumber(id))
					local skipReason = getSkipReason(info)
					if skipReason then
						if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
						print(string.format("[ISpooferMotion] Skipping sound %s (%s)", info and info.Name or id, skipReason))
					else
						processedSoundIds[id] = true
						addAsset({
							kind = "SoundInstance",
							name = obj.Name,
							fullName = obj:GetFullName(),
							soundId = obj.SoundId,
							assetId = id,
							assetName = (info and info.Name) or obj.Name,
							creator = (info and info.Creator and info.Creator.Name) or "Unknown",
						})
					end
				end
			end
			if obj:IsA("LuaSourceContainer") then
				for id in obj.Source:gmatch("rbxassetid://(%d+)") do
					scriptMatches = scriptMatches + 1
					if not processedSoundIds[id] then
						local info = getProductInfo(tonumber(id))
						if info and info.AssetTypeId == 3 then
							local skipReason = getSkipReason(info)
							if skipReason then
								if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
								print(string.format("[ISpooferMotion] Skipping script sound %s (%s)", info.Name or id, skipReason))
							else
								processedSoundIds[id] = true
								addAsset({
									kind = "ScriptReference",
									script = obj:GetFullName(),
									assetId = id,
									soundId = "rbxassetid://" .. id,
									assetName = info.Name or "Asset " .. id,
									creator = info.Creator and info.Creator.Name or "Unknown",
								})
							end
						elseif not info then
							processedSoundIds[id] = true
							infoMissing = infoMissing + 1
							addAsset({
								kind = "ScriptReference",
								script = obj:GetFullName(),
								assetId = id,
								soundId = "rbxassetid://" .. id,
								assetName = "Asset " .. id,
								creator = "Unknown",
								infoMissing = true,
								typeHint = "Sound",
							})
						end
					end
				end
			end
		end
	end

	-- Send remaining batch
	flushBatch()

	logScanProgress("Sounds", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
	print(string.format("[ISpooferMotion] ✓ 100%% - Found %d sounds (scriptMatches=%d) in %.2fs", totalFound, scriptMatches, os.clock() - startClock))

	signalComplete(urls.soundsComplete, "sound")
end

local function scanAnimationsIncremental()
	local batch = {}
	local batchSize = 1 -- 10x larger batches
	local spooferOutput = game:GetService("ServerStorage"):FindFirstChild("Spoofer-Output")

	local startClock = os.clock()
	local scanned = 0
	local skippedOwned = 0
	local skippedPublic = 0
	local infoMissing = 0
	local scriptMatches = 0
	local lastProgressPercent = 0

	-- Clear processed IDs for fresh scan
	processedAnimationIds = {}

	print("[ISpooferMotion] Starting animation scan (streaming mode)...")
	print(string.format("[ISpooferMotion] Scan speed: %s | Progress reports: %s | Timeout: %s", 
		scanSpeed, 
		showProgressReports and "Enabled" or "Disabled",
		disableScanTimeout and "Disabled" or "Enabled"))
	print("[ISpooferMotion] Scanning: game descendants, excluding ServerStorage/Spoofer-Output")

	-- Get all descendants first to calculate total
	local allDescendants = game:GetDescendants()
	local totalObjects = #allDescendants
	print(string.format("[ISpooferMotion] Total objects to scan: %d", totalObjects))

	-- Stream batches as they fill
	local currentBatch = {}
	local totalFound = 0
	local checkInterval = getCheckInterval()
	local scanDelay = getScanDelay()

	local function flushBatch()
		if #currentBatch > 0 then
			sendBatch(currentBatch, urls.sendAnimations, "animations")
			currentBatch = {}
		end
	end

	local function addAsset(asset)
		table.insert(currentBatch, asset)
		totalFound = totalFound + 1
		if #currentBatch >= batchSize then
			flushBatch()
		end
	end

	for _, obj in pairs(allDescendants) do
		scanned = scanned + 1

		-- Progress reporting
		if showProgressReports then
			local currentPercent = math.floor((scanned / totalObjects) * 100)
			if currentPercent >= lastProgressPercent + 10 and currentPercent % 10 == 0 then
				print(string.format("[ISpooferMotion] Animations: %d%% complete (scanned %d/%d, found %d assets)", 
					currentPercent, scanned, totalObjects, totalFound))
				lastProgressPercent = currentPercent
			end
		end

		-- Yield control based on scan speed
		if scanned % checkInterval == 0 then
			task.wait(scanDelay)
		end

		if scanned % 5000 == 0 then
			logScanProgress("Animations", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
		end

		if not obj:IsDescendantOf(spooferOutput or Instance.new("Folder")) then
			if obj:IsA("Animation") then
				local id = obj.AnimationId:match("rbxassetid://(%d+)")
				if id and not processedAnimationIds[id] then
					local info = getProductInfo(tonumber(id))
					local skipReason = getSkipReason(info)
					if skipReason then
						if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
						print(string.format("[ISpooferMotion] Skipping animation %s (%s)", info and info.Name or id, skipReason))
					else
						processedAnimationIds[id] = true
						addAsset({
							kind = "AnimationInstance",
							name = obj.Name,
							fullName = obj:GetFullName(),
							animationId = obj.AnimationId,
							assetId = id,
							assetName = (info and info.Name) or obj.Name,
							creator = (info and info.Creator and info.Creator.Name) or "Unknown",
						})
					end
				end
			end
			if obj:IsA("LuaSourceContainer") then
				for id in obj.Source:gmatch("rbxassetid://(%d+)") do
					scriptMatches = scriptMatches + 1
					if not processedAnimationIds[id] then
						local info = getProductInfo(tonumber(id))
						if info and info.AssetTypeId == 24 then
							local skipReason = getSkipReason(info)
							if skipReason then
								if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
								print(string.format("[ISpooferMotion] Skipping script animation %s (%s)", info.Name or id, skipReason))
							else
								processedAnimationIds[id] = true
								addAsset({
									kind = "ScriptReference",
									script = obj:GetFullName(),
									assetId = id,
									animationId = "rbxassetid://" .. id,
									assetName = info.Name or "Asset " .. id,
									creator = info.Creator and info.Creator.Name or "Unknown",
								})
							end
						elseif not info then
							processedAnimationIds[id] = true
							infoMissing = infoMissing + 1
							addAsset({
								kind = "ScriptReference",
								script = obj:GetFullName(),
								assetId = id,
								animationId = "rbxassetid://" .. id,
								assetName = "Asset " .. id,
								creator = "Unknown",
								infoMissing = true,
								typeHint = "Animation",
							})
						end
					end
				end
			end
		end
	end

	-- Send remaining batch
	flushBatch()

	logScanProgress("Animations", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
	print(string.format("[ISpooferMotion] ✓ 100%% - Found %d animations (scriptMatches=%d) in %.2fs", totalFound, scriptMatches, os.clock() - startClock))

	signalComplete(urls.animationsComplete, "animation")
end

local function scanImagesIncremental()
	local batch = {}
	local batchSize = 1
	local spooferOutput = game:GetService("ServerStorage"):FindFirstChild("Spoofer-Output")
	local coreGui = game:GetService("CoreGui")
	local pluginGuiService = game:FindService("PluginGuiService") or game:GetService("PluginGuiService")

	local startClock = os.clock()
	local scanned = 0
	local skippedOwned = 0
	local skippedPublic = 0
	local infoMissing = 0
	local scriptMatches = 0
	local lastProgressPercent = 0

	-- Clear processed IDs for fresh scan
	processedImageIds = {}

	print("[ISpooferMotion] Starting image scan (streaming mode)...")
	print(string.format("[ISpooferMotion] Scan speed: %s | Progress reports: %s | Timeout: %s", 
		scanSpeed, 
		showProgressReports and "Enabled" or "Disabled",
		disableScanTimeout and "Disabled" or "Enabled"))
	print("[ISpooferMotion] Scanning: game descendants, excluding Spoofer-Output, CoreGui, PluginGui")

	-- Get all descendants first to calculate total
	local allDescendants = game:GetDescendants()
	local totalObjects = #allDescendants
	print(string.format("[ISpooferMotion] Total objects to scan: %d", totalObjects))

	-- Stream batches as they fill
	local currentBatch = {}
	local totalFound = 0
	local checkInterval = getCheckInterval()
	local scanDelay = getScanDelay()
	-- Use persistent processedIds table
	local processedIds = processedImageIds

	local function flushBatch()
		if #currentBatch > 0 then
			sendBatch(currentBatch, urls.sendImages, "images")
			currentBatch = {}
		end
	end

	local function addAsset(asset)
		table.insert(currentBatch, asset)
		totalFound = totalFound + 1
		if #currentBatch >= batchSize then
			flushBatch()
		end
	end

	-- Helper to extract and store image ID
	local function addImageAsset(obj, propertyName, propertyValue)
		local id = propertyValue:match("rbxassetid://(%d+)") or propertyValue:match("rbxthumb://type=Asset&id=(%d+)") or propertyValue:match("^(%d+)$")
		if id and not processedIds[id] then
			local info = getProductInfo(tonumber(id))
			local skipReason = getSkipReason(info)
			if skipReason then
				if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
				print(string.format("[ISpooferMotion] Skipping image %s (%s)", info and info.Name or id, skipReason))
				return
			end
			processedIds[id] = true
			addAsset({
				kind = obj.ClassName,
				name = obj.Name,
				fullName = obj:GetFullName(),
				property = propertyName,
				imageId = propertyValue,
				assetId = id,
				assetName = (info and info.Name) or obj.Name,
				creator = (info and info.Creator and info.Creator.Name) or "Unknown",
			})
		end
	end

	for _, obj in pairs(allDescendants) do
		scanned = scanned + 1

		-- Progress reporting
		if showProgressReports then
			local currentPercent = math.floor((scanned / totalObjects) * 100)
			if currentPercent >= lastProgressPercent + 10 and currentPercent % 10 == 0 then
				print(string.format("[ISpooferMotion] Images: %d%% complete (scanned %d/%d, found %d assets)", 
					currentPercent, scanned, totalObjects, totalFound))
				lastProgressPercent = currentPercent
			end
		end

		-- Yield control based on scan speed
		if scanned % checkInterval == 0 then
			task.wait(scanDelay)
		end

		if scanned % 5000 == 0 then
			logScanProgress("Images", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
		end

		local inOutput = spooferOutput and obj:IsDescendantOf(spooferOutput)
		local inCoreGui = coreGui and obj:IsDescendantOf(coreGui)
		local inPluginGui = pluginGuiService and obj:IsDescendantOf(pluginGuiService)
		if not inOutput and not inCoreGui and not inPluginGui then
			-- Image-containing GUI elements
			if obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
				if obj.Image and obj.Image ~= "" then
					addImageAsset(obj, "Image", obj.Image)
				end
			end

			-- Decals and Textures
			if obj:IsA("Decal") then
				if obj.Texture and obj.Texture ~= "" then
					addImageAsset(obj, "Texture", obj.Texture)
				end
			end

			if obj:IsA("Texture") then
				if obj.Texture and obj.Texture ~= "" then
					addImageAsset(obj, "Texture", obj.Texture)
				end
			end

			-- Sky textures
			if obj:IsA("Sky") then
				for _, prop in ipairs({"SkyboxBk", "SkyboxDn", "SkyboxFt", "SkyboxLf", "SkyboxRt", "SkyboxUp"}) do
					local value = obj[prop]
					if value and value ~= "" then
						addImageAsset(obj, prop, value)
					end
				end
			end

			-- Particle effects
			if obj:IsA("ParticleEmitter") or obj:IsA("Beam") or obj:IsA("Trail") then
				if obj.Texture and obj.Texture ~= "" then
					addImageAsset(obj, "Texture", obj.Texture)
				end
			end

			-- MeshPart textures
			if obj:IsA("MeshPart") then
				if obj.TextureID and obj.TextureID ~= "" then
					addImageAsset(obj, "TextureID", obj.TextureID)
				end
			end

			-- Scripts (search for asset ID references - collect all patterns)
			if obj:IsA("LuaSourceContainer") then
				local scriptSource = obj.Source

				-- Pattern 1: rbxassetid://12345
				for id in scriptSource:gmatch("rbxassetid://(%d+)") do
					scriptMatches = scriptMatches + 1
					if not processedIds[id] then
						local info = getProductInfo(tonumber(id))
						-- Only include if it's actually an image (AssetTypeId == 1 for Image, 13 for Decal)
						if info and (info.AssetTypeId == 1 or info.AssetTypeId == 13) then
							local skipReason = getSkipReason(info)
							if skipReason then
								if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
								print(string.format("[ISpooferMotion] Skipping script image %s (%s)", info.Name or id, skipReason))
							else
								processedIds[id] = true
								addAsset({
									kind = "ScriptReference",
									script = obj:GetFullName(),
									assetId = id,
									imageId = "rbxassetid://" .. id,
									assetName = info.Name or "Asset " .. id,
									creator = info.Creator and info.Creator.Name or "Unknown",
								})
							end
						elseif not info then
							processedIds[id] = true
							infoMissing = infoMissing + 1
							addAsset({
								kind = "ScriptReference",
								script = obj:GetFullName(),
								assetId = id,
								imageId = "rbxassetid://" .. id,
								assetName = "Asset " .. id,
								creator = "Unknown",
								infoMissing = true,
								typeHint = "Image",
							})
						end
					end
				end

				-- Pattern 2: rbxthumb://type=Asset&id=12345
				for id in scriptSource:gmatch("rbxthumb://type=Asset&id=(%d+)") do
					scriptMatches = scriptMatches + 1
					if not processedIds[id] then
						local info = getProductInfo(tonumber(id))
						if info and (info.AssetTypeId == 1 or info.AssetTypeId == 13) then
							local skipReason = getSkipReason(info)
							if skipReason then
								if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
								print(string.format("[ISpooferMotion] Skipping script image %s (%s)", info.Name or id, skipReason))
							else
								processedIds[id] = true
								addAsset({
									kind = "ScriptReference",
									script = obj:GetFullName(),
									assetId = id,
									imageId = "rbxthumb://type=Asset&id=" .. id,
									assetName = info.Name or "Asset " .. id,
									creator = info.Creator and info.Creator.Name or "Unknown",
								})
							end
						elseif not info then
							processedIds[id] = true
							infoMissing = infoMissing + 1
							addAsset({
								kind = "ScriptReference",
								script = obj:GetFullName(),
								assetId = id,
								imageId = "rbxthumb://type=Asset&id=" .. id,
								assetName = "Asset " .. id,
								creator = "Unknown",
								infoMissing = true,
								typeHint = "Image",
							})
						end
					end
				end

				-- Pattern 3: http://www.roblox.com/asset/?id=12345 or https://
				for id in scriptSource:gmatch("https?://[%w%.]*roblox%.com/[Aa]sset/%?[Ii][Dd]=(%d+)") do
					scriptMatches = scriptMatches + 1
					if not processedIds[id] then
						local info = getProductInfo(tonumber(id))
						if info and (info.AssetTypeId == 1 or info.AssetTypeId == 13) then
							local skipReason = getSkipReason(info)
							if skipReason then
								if skipReason == "owned" then skippedOwned = skippedOwned + 1 else skippedPublic = skippedPublic + 1 end
								print(string.format("[ISpooferMotion] Skipping script image %s (%s)", info.Name or id, skipReason))
							else
								processedIds[id] = true
								addAsset({
									kind = "ScriptReference",
									script = obj:GetFullName(),
									assetId = id,
									imageId = "http://www.roblox.com/asset/?id=" .. id,
									assetName = info.Name or "Asset " .. id,
									creator = info.Creator and info.Creator.Name or "Unknown",
								})
							end
						elseif not info then
							processedIds[id] = true
							infoMissing = infoMissing + 1
							addAsset({
								kind = "ScriptReference",
								script = obj:GetFullName(),
								assetId = id,
								imageId = "http://www.roblox.com/asset/?id=" .. id,
								assetName = "Asset " .. id,
								creator = "Unknown",
								infoMissing = true,
								typeHint = "Image",
							})
						end
					end
				end
			end
		end
	end

	-- Send remaining batch
	flushBatch()

	logScanProgress("Images", scanned, totalFound, skippedOwned, skippedPublic, infoMissing)
	print(string.format("[ISpooferMotion] ✓ 100%% - Found %d images (scriptMatches=%d) in %.2fs", totalFound, scriptMatches, os.clock() - startClock))

	signalComplete(urls.imagesComplete, "image")
end

local function pollLoop(pollUrl, onRequest, label)
	local cancelFlag = false
	local consecutiveFailures = 0
	local lastSuccessTime = nil
	local taskInfo = {
		cancel = function()
			cancelFlag = true
		end
	}

	task.spawn(function()
		while not cancelFlag do
			if connectionEnabled then
				local ok, response = pcall(function()
					return HttpService:GetAsync(pollUrl)
				end)
				if ok and response then
					consecutiveFailures = 0
					lastSuccessTime = os.clock()
					local decodedOk, decoded = pcall(function()
						return HttpService:JSONDecode(response)
					end)
					if decodedOk and decoded then
						if decoded.skipOwnedCheck ~= nil then
							SKIP_OWNED_CHECK = decoded.skipOwnedCheck == true
						end
						if decoded.requestAssets then
							print(string.format("[ISpooferMotion] Localhost requested %s scan", label))
							onRequest()
						end
					else
						warn(string.format("[ISpooferMotion] Failed to decode JSON from %s", pollUrl))
					end
				else
					consecutiveFailures = consecutiveFailures + 1
					if connectionEnabled then
						if consecutiveFailures == 1 then
							warn(string.format("[ISpooferMotion] Failed to connect to %s: %s", pollUrl, tostring(response)))
							warn("[ISpooferMotion] Common fixes:")
							warn("  1. Make sure the ISpooferMotion app is running")
							warn("  2. Enable HttpService: Home > Game Settings > Security > Allow HTTP Requests")
							warn("  3. Check if port " .. currentPort .. " is correct")
						elseif consecutiveFailures % 20 == 0 then
							warn(string.format("[ISpooferMotion] Still failing after %d attempts (%s)", consecutiveFailures, label))
						end
					end
				end
			end
			task.wait(0.5) -- Poll 2x faster
		end
	end)

	return taskInfo
end

pollTasks["sounds"] = pollLoop(urls.pollSounds, scanSoundsIncremental, "Sound")
pollTasks["animations"] = pollLoop(urls.pollAnimations, scanAnimationsIncremental, "Animation")
pollTasks["images"] = pollLoop(urls.pollImages, scanImagesIncremental, "Image")

-- =====================================
-- ID REPLACEMENT FUNCTION
-- =====================================
-- This function replaces all instances of old asset IDs with new ones
-- The mappings array contains: {originalId, newId, name, type}
-- MUST BE DEFINED BEFORE the replacement polling loop uses it
local function replaceAssetIds(mappings)
	if not mappings or #mappings == 0 then
		warn("[ISpooferMotion] No mappings provided for ID replacement")
		return
	end

	print(string.format("[ISpooferMotion] Starting ID replacement for %d mappings...", #mappings))

	-- Create lookup tables grouped by type for clarity and to avoid confusion
	local idMapByType = {}
	for _, mapping in ipairs(mappings) do
		local typeKey = mapping.type or "Animation" -- Default to Animation
		if not idMapByType[typeKey] then
			idMapByType[typeKey] = {}
		end
		idMapByType[typeKey][tostring(mapping.originalId)] = tostring(mapping.newId)
		print(string.format("[ISpooferMotion] Mapping [%s] %s → %s (%s)", typeKey, mapping.originalId, mapping.newId, mapping.name))
	end

	local replacedCount = 0

	-- Iterate through all descendants and replace asset IDs
	for _, obj in pairs(game:GetDescendants()) do
		-- Replace Sound.SoundId (Sound type)
		if obj:IsA("Sound") then
			if obj.SoundId and obj.SoundId ~= "" and obj.SoundId:find("rbxassetid://") then
				local oldId = obj.SoundId:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Sound"] and idMapByType["Sound"][oldId]
					if newId then
						obj.SoundId = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced Sound %s → %s in %s", oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace Animation.AnimationId (Animation type)
		if obj:IsA("Animation") then
			if obj.AnimationId and obj.AnimationId ~= "" and obj.AnimationId:find("rbxassetid://") then
				local oldId = obj.AnimationId:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Animation"] and idMapByType["Animation"][oldId]
					if newId then
						obj.AnimationId = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced Animation %s → %s in %s", oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace ImageLabel and ImageButton (Image type)
		if obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
			if obj.Image and obj.Image ~= "" and obj.Image:find("rbxassetid://") then
				local oldId = obj.Image:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
					if newId then
						obj.Image = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced Image %s → %s in %s", oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace Decal.Texture (Image type)
		if obj:IsA("Decal") then
			if obj.Texture and obj.Texture ~= "" and obj.Texture:find("rbxassetid://") then
				local oldId = obj.Texture:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
					if newId then
						obj.Texture = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced Decal %s → %s in %s", oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace Texture.Texture (Image type)
		if obj:IsA("Texture") then
			if obj.Texture and obj.Texture ~= "" and obj.Texture:find("rbxassetid://") then
				local oldId = obj.Texture:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
					if newId then
						obj.Texture = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced Texture %s → %s in %s", oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace Sky faces (Image type)
		if obj:IsA("Sky") then
			for _, face in ipairs({"SkyboxFt", "SkyboxBk", "SkyboxLf", "SkyboxRt", "SkyboxUp", "SkyboxDn"}) do
				local property = obj[face]
				if property and tostring(property) ~= "" and tostring(property):find("rbxassetid://") then
					local oldId = tostring(property):match("rbxassetid://(%d+)")
					if oldId then
						local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
						if newId then
							obj[face] = "rbxassetid://" .. newId
							replacedCount = replacedCount + 1
							print(string.format("[ISpooferMotion] Replaced Sky face %s %s → %s", face, oldId, newId))
						end
					end
				end
			end
		end

		-- Replace ParticleEmitter, Beam, Trail texture (Image type)
		if obj:IsA("ParticleEmitter") or obj:IsA("Beam") or obj:IsA("Trail") then
			if obj.Texture and obj.Texture ~= "" and obj.Texture:find("rbxassetid://") then
				local oldId = obj.Texture:match("rbxassetid://(%d+)")
				if oldId then
					local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
					if newId then
						obj.Texture = "rbxassetid://" .. newId
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced %s %s → %s in %s", obj.ClassName, oldId, newId, obj:GetFullName()))
					end
				end
			end
		end

		-- Replace MeshPart.TextureID (Image type)
		if obj:IsA("MeshPart") and obj.TextureID and obj.TextureID ~= "" and obj.TextureID:find("rbxassetid://") then
			local oldId = obj.TextureID:match("rbxassetid://(%d+)")
			if oldId then
				local newId = idMapByType["Image"] and idMapByType["Image"][oldId]
				if newId then
					obj.TextureID = "rbxassetid://" .. newId
					replacedCount = replacedCount + 1
					print(string.format("[ISpooferMotion] Replaced MeshPart texture %s → %s in %s", oldId, newId, obj:GetFullName()))
				end
			end
		end

		-- Replace in scripts (LuaSourceContainer) - rbxassetid:// URLs
		if obj:IsA("LuaSourceContainer") then
			local source = obj.Source
			local modified = false

			-- Replace rbxassetid:// URLs for all types
			for typeKey, idMap in pairs(idMapByType) do
				for oldId, newId in pairs(idMap) do
					local pattern = "rbxassetid://" .. oldId
					local replacement = "rbxassetid://" .. newId
					if source:find(pattern, 1, true) then
						source = source:gsub(pattern, replacement)
						modified = true
						replacedCount = replacedCount + 1
						print(string.format("[ISpooferMotion] Replaced script [%s] %s → %s in %s", typeKey, oldId, newId, obj:GetFullName()))
					end
				end
			end

			if modified then
				obj.Source = source
			end
		end
	end

	print(string.format("[ISpooferMotion] ✓ Replacement complete! Total replacements: %d", replacedCount))
	return replacedCount
end

-- =============================================
-- REPLACEMENT POLLING LOOP
-- =============================================
pollTasks["replacements"] = (function()
	local cancelFlag = false
	local taskInfo = {
		cancel = function()
			cancelFlag = true
		end
	}

	local pollInterval = 1
	local maxPollInterval = 10
	local consecutiveEmpty = 0

	task.spawn(function()
		while not cancelFlag do
			if connectionEnabled then
				task.wait(pollInterval)
				local ok, response = pcall(function()
					return HttpService:GetAsync(urls.pollReplacements)
				end)
				if ok and response then
					local decodedOk, decoded = pcall(function()
						return HttpService:JSONDecode(response)
					end)
					if decodedOk and decoded and decoded.mappings and #decoded.mappings > 0 then
						print(string.format("[ISpooferMotion] Received %d ID replacements from server", #decoded.mappings))
						-- Reset polling interval on successful replacement
						consecutiveEmpty = 0
						pollInterval = 1
						-- Convert JSON objects to Lua tables
						local mappings = {}
						for _, m in ipairs(decoded.mappings) do
							table.insert(mappings, {
								originalId = tonumber(m.originalId) or m.originalId,
								newId = tonumber(m.newId) or m.newId,
								name = m.name,
								type = m.type,
							})
						end
						-- Execute replacements
						replaceAssetIds(mappings)
					else
						-- Exponential backoff when no replacements
						consecutiveEmpty = consecutiveEmpty + 1
						if consecutiveEmpty > 3 then
							pollInterval = math.min(pollInterval * 1.5, maxPollInterval)
						end
					end
				end
			else
				task.wait(1)
			end
		end
	end)

	return taskInfo
end)()

-- Store the function globally so it can be called by the external system
_G.replaceAssetIds = replaceAssetIds
print("[ISpooferMotion] ID replacement function registered")