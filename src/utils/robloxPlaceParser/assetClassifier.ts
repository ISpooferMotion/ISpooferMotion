import type { ParsedAssetRef, RobloxAssetType } from './types';

const ASSET_URL_PATTERNS = [/^rbxassetid:\/\/(\d+)/i, /[?&]id=(\d+)/i, /^(\d{7,})$/];

export function extractAssetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const pattern of ASSET_URL_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) return m[1];
  }

  return null;
}

const PROPERTY_MAP: Array<{
  className: string | null;
  property: string;
  type: RobloxAssetType;
}> = [
  { className: 'Animation', property: 'AnimationId', type: 'animation' },
  { className: 'AnimationTrack', property: 'AnimationId', type: 'animation' },
  { className: null, property: 'AnimationId', type: 'animation' },

  { className: 'Sound', property: 'SoundId', type: 'audio' },
  { className: null, property: 'SoundId', type: 'audio' },

  { className: 'Decal', property: 'Texture', type: 'image' },
  { className: 'Texture', property: 'Texture', type: 'image' },
  { className: 'ImageLabel', property: 'Image', type: 'image' },
  { className: 'ImageButton', property: 'Image', type: 'image' },
  { className: 'SpecialMesh', property: 'TextureId', type: 'image' },
  { className: 'FileMesh', property: 'TextureId', type: 'image' },
  { className: null, property: 'TextureId', type: 'image' },
  { className: 'Sky', property: 'SkyboxBk', type: 'image' },
  { className: 'Sky', property: 'SkyboxDn', type: 'image' },
  { className: 'Sky', property: 'SkyboxFt', type: 'image' },
  { className: 'Sky', property: 'SkyboxLf', type: 'image' },
  { className: 'Sky', property: 'SkyboxRt', type: 'image' },
  { className: 'Sky', property: 'SkyboxUp', type: 'image' },

  { className: 'MeshPart', property: 'MeshId', type: 'mesh' },
  { className: 'SpecialMesh', property: 'MeshId', type: 'mesh' },
  { className: 'FileMesh', property: 'MeshId', type: 'mesh' },
  { className: null, property: 'MeshId', type: 'mesh' },

  { className: 'Script', property: 'LinkedSource', type: 'script_ref' },
  { className: 'LocalScript', property: 'LinkedSource', type: 'script_ref' },
  { className: 'ModuleScript', property: 'LinkedSource', type: 'script_ref' },
  { className: null, property: 'LinkedSource', type: 'script_ref' },
];

export function classifyProperty(className: string, propertyName: string): RobloxAssetType | null {
  for (const entry of PROPERTY_MAP) {
    if (entry.className !== null && entry.className !== className) continue;
    if (entry.property !== propertyName) continue;
    return entry.type;
  }
  return null;
}

export function buildAssetRef(
  className: string,
  instanceName: string,
  propertyName: string,
  rawValue: string,
  assetId: string,
  path: string,
  type: RobloxAssetType,
): ParsedAssetRef {
  return {
    type,
    assetId,
    rawValue,
    className,
    instanceName,
    propertyName,
    path,
  };
}
