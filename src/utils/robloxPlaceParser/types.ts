export type RobloxAssetType =
  | 'animation'
  | 'audio'
  | 'image'
  | 'mesh'
  | 'plugin'
  | 'script_ref'
  | 'unknown';

export interface ParsedAssetRef {
  type: RobloxAssetType;

  assetId: string;

  rawValue: string;

  className: string;

  instanceName: string;

  propertyName: string;

  path: string;
}

export type RobloxFileType = 'rbxlx' | 'rbxl' | 'unknown';

export interface ParseProgress {
  phase: string;
  current: number;
  total: number;
  eta?: string;
}

export type ParseProgressCallback = (progress: ParseProgress) => void;

export interface PlaceParseResult {
  fileType: RobloxFileType;

  rootInstances: RbxInstance[];

  warnings: string[];
}

export interface RbxInstance {
  referent: string;
  className: string;
  name: string;

  assets: ParsedAssetRef[];
  children: RbxInstance[];
}
