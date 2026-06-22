local function copyMeshPartPropertiesInto(src: MeshPart, dst: BasePart, overrideTextureId: string?)
	pcall(function()
		dst.Name = src.Name
		dst.CFrame = src.CFrame
		dst.Size = src.Size
		dst.Anchored = src.Anchored
		dst.Archivable = src.Archivable
		dst.PivotOffset = src.PivotOffset
	end)
	pcall(function()
		dst.CanCollide = src.CanCollide
		dst.CanTouch = src.CanTouch
		dst.CanQuery = src.CanQuery
		dst.CastShadow = src.CastShadow
		dst.CollisionGroup = src.CollisionGroup
	end)
	pcall(function()
		dst.Color = src.Color
		dst.Material = src.Material
		dst.Transparency = src.Transparency
		dst.Reflectance = src.Reflectance
	end)
	pcall(function()
		dst.MaterialVariant = src.MaterialVariant
	end)
	pcall(function()
		dst.Locked = src.Locked
		dst.Massless = src.Massless
		dst.RootPriority = src.RootPriority
		dst.CustomPhysicalProperties = src.CustomPhysicalProperties
	end)
	pcall(function()
		dst.AssemblyLinearVelocity = src.AssemblyLinearVelocity
		dst.AssemblyAngularVelocity = src.AssemblyAngularVelocity
	end)
	if dst:IsA("MeshPart") then
		local meshDst = dst :: MeshPart
		pcall(function()
			meshDst.TextureID = overrideTextureId or src.TextureID
		end)
		pcall(function()
			meshDst.CollisionFidelity = src.CollisionFidelity
		end)
		pcall(function()
			meshDst.RenderFidelity = src.RenderFidelity
		end)
		pcall(function()
			(meshDst :: any).DoubleSided = (src :: any).DoubleSided
		end)
	end
	pcall(function()
		for key, value in pairs(src:GetAttributes()) do
			pcall(function()
				dst:SetAttribute(key, value)
			end)
		end
	end)
	pcall(function()
		for _, tag in ipairs(CollectionService:GetTags(src)) do
			pcall(function()
				CollectionService:AddTag(dst, tag)
			end)
		end
	end)
end

local function rewritePartReference(obj: Instance, src: BasePart, dst: BasePart)
	pcall(function()
		local anyObj = obj :: any
		if anyObj.Part0 == src then
			anyObj.Part0 = dst
		end
	end)
	pcall(function()
		local anyObj = obj :: any
		if anyObj.Part1 == src then
			anyObj.Part1 = dst
		end
	end)
end

local function moveMeshPartContentsInto(src: BasePart, dst: BasePart)
	pcall(function()
		src.Parent = nil
	end)

	for _, child in ipairs(src:GetChildren()) do
		pcall(function()
			child.Parent = dst
		end)
	end

	local seen: { [Instance]: boolean } = {}
	for _, joint in ipairs(src:GetJoints()) do
		seen[joint] = true
		rewritePartReference(joint, src, dst)
	end
	for _, descendant in ipairs(dst:GetDescendants()) do
		if not seen[descendant] then
			seen[descendant] = true
			rewritePartReference(descendant, src, dst)
		end
	end
end

-- selene: allow(unused_variable)
local function copyMeshPartInto(src: MeshPart, dst: BasePart, overrideTextureId: string?)
	copyMeshPartPropertiesInto(src, dst, overrideTextureId)
	moveMeshPartContentsInto(src, dst)
end
