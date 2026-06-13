local objectRegistry: { [string]: Instance } = setmetatable({} :: any, { __mode = "v" })
local objectTokens: { [Instance]: string } = setmetatable({} :: any, { __mode = "k" })
local scanGeneration: number = 0

local function resetObjectRegistry()
	scanGeneration += 1
	objectRegistry = setmetatable({} :: any, { __mode = "v" })
	objectTokens = setmetatable({} :: any, { __mode = "k" })
end

local function registerObject(obj: Instance): string
	local existing = objectTokens[obj]
	if existing then
		return existing
	end

	local token = tostring(scanGeneration) .. ":" .. HttpService:GenerateGUID(false)
	objectTokens[obj] = token
	objectRegistry[token] = obj
	return token
end

local function getRegisteredObject(token: string): Instance?
	local obj = objectRegistry[tostring(token)]
	if not obj then
		return nil
	end

	local valid, parent = pcall(function()
		return obj.Parent
	end)

	return if valid and parent ~= nil then obj else nil
end

local function replaceRegisteredObject(token: string, obj: Instance)
	local normalizedToken = tostring(token)
	local oldObj = objectRegistry[normalizedToken]
	if oldObj then
		objectTokens[oldObj] = nil
	end

	local oldToken = objectTokens[obj]
	if oldToken and oldToken ~= normalizedToken then
		objectRegistry[oldToken] = nil
	end

	objectRegistry[normalizedToken] = obj
	objectTokens[obj] = normalizedToken
end
