import { Button, MultiSelectToggle } from '@codycon/ism-library';
import { ChevronRight, Copy, Image as ImageIcon, Play, Square, ZoomIn } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import type { AppConfig } from '../../../contexts/ConfigContext';
import { cn } from '../../../utils/cn';
import { playRobloxAudio, stopRobloxAudio } from '../../../utils/robloxAudio';
import type { ParsedAssetRef, RbxInstance } from '../../../utils/robloxPlaceParser';
import { logIsm } from '../../../utils/robloxProfiles';

export const getAssetId = (asset: ParsedAssetRef | { id: string; name: string }) => {
  if ('assetId' in asset) return asset.assetId;
  return asset.id ?? '';
};

export const ExplorerTreeNode = memo(function ExplorerTreeNode({
  node,
  level,
  config,
  selectedAssetIds,
  toggleAsset,
  toggleNode,
  getAllAssetIds,
  setEnlargedImage,
  setPreviewingAnimation,
  activeAssetFilters,
  playingAudioId,
}: {
  node: RbxInstance;
  level: number;
  config: AppConfig;
  selectedAssetIds: Set<string>;
  toggleAsset: (id: string, checked: boolean) => void;
  toggleNode: (node: RbxInstance, checked: boolean) => void;
  getAllAssetIds: (node: RbxInstance) => string[];
  setEnlargedImage: (value: { id: string; name: string } | null) => void;
  setPreviewingAnimation: (value: { id: string; name: string } | null) => void;
  activeAssetFilters: string[];
  playingAudioId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedAssetKey, setExpandedAssetKey] = useState<string | null>(null);
  const matchesFilter = (type: string) =>
    activeAssetFilters.length === 0 || activeAssetFilters.includes(type);
  const filteredAssets = useMemo(() => {
    return node.assets.filter((asset) => matchesFilter(asset.type));
  }, [node.assets, activeAssetFilters]);
  const totalChildren = node.children.length;
  const allIds = getAllAssetIds(node);

  if (allIds.length === 0) return null;

  const selectedCount = allIds.filter((id) => selectedAssetIds.has(id)).length;
  const isChecked = selectedCount === allIds.length;
  const isIndeterminate = selectedCount > 0 && selectedCount < allIds.length;

  const copyAssetId = async (asset: ParsedAssetRef) => {
    // copy to clipboard so they can paste it manually if needed
    const assetId = getAssetId(asset);
    if (!assetId) return;
    await navigator.clipboard.writeText(assetId);
    logIsm('success', `Copied asset id ${assetId}.`);
  };

  const playAsset = async (asset: ParsedAssetRef) => {
    // try to play the selected audio file using tauri's media apis
    const assetId = getAssetId(asset);
    if (!assetId) {
      logIsm('warn', 'Cannot play Roblox audio without an asset id.');
      return;
    }
    if (playingAudioId === assetId) {
      stopRobloxAudio();
      return;
    }
    await playRobloxAudio(assetId, config).catch((error) => {
      logIsm('error', `Failed to play Roblox audio ${assetId}: ${String(error)}`);
    });
  };

  const getTypeIconSrc = (asset: ParsedAssetRef) => {
    if (asset.type === 'animation') return '/icons/Animation.png';
    if (asset.type === 'audio') return '/icons/Sound.png';
    if (asset.type === 'mesh') return '/icons/MeshPart.png';
    if (asset.type === 'image') return '/icons/Decal.png';
    return '/icons/Object.png';
  };

  const getAssetTitle = (asset: ParsedAssetRef) => {
    const name = asset.instanceName || asset.propertyName || asset.path.split('.').pop();
    return name || `${asset.type} ${asset.assetId}`;
  };

  const renderAssetRow = (asset: ParsedAssetRef, index: number) => {
    // render each individual asset inside the explorer tree, kinda matches studio's look
    const assetId = getAssetId(asset);
    const isSound = asset.type === 'audio';
    const isAnimation = asset.type === 'animation';
    const isMesh = asset.type === 'mesh';
    const isImage = asset.type === 'image';
    const instanceCount = (asset as ParsedAssetRef & { instanceCount?: number }).instanceCount;
    const assetKey = `${asset.type}:${asset.path}:${asset.propertyName}:${assetId}:${index}`;
    const isOpen = expandedAssetKey === assetKey;

    return (
      <div
        className="rounded-sm hover:bg-bg-elevated/60 group"
        style={{ marginLeft: `${(level + 1) * 16 + 18}px` }}
      >
        <div
          className="min-h-9 flex items-center pr-2 cursor-pointer"
          onClick={() => setExpandedAssetKey(isOpen ? null : assetKey)}
        >
          <div
            className="mr-2 cursor-pointer flex items-center justify-center shrink-0"
            onClick={(event: any) => {
              event.stopPropagation();
              toggleAsset(assetId, !selectedAssetIds.has(assetId));
            }}
          >
            <MultiSelectToggle checked={selectedAssetIds.has(assetId)} />
          </div>
          <ChevronRight
            size={12}
            className={cn(
              'mr-1 shrink-0 text-text-muted transition-transform',
              isOpen && 'rotate-90',
            )}
          />

          <div className="w-4 h-4 shrink-0 mr-2 flex items-center justify-center">
            <img
              src={getTypeIconSrc(asset)}
              alt=""
              className="w-full h-full object-contain"
              onError={(event: any) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <span className="text-[11px] text-text-secondary truncate flex items-center gap-1">
              {getAssetTitle(asset)}
              {(instanceCount ?? 1) > 1 && (
                <span className="text-[9px] text-text-muted bg-bg-base px-1 rounded-sm border border-border-subtle">
                  {instanceCount}x
                </span>
              )}
            </span>
            <span className="text-[9px] text-text-muted truncate">
              {asset.propertyName || asset.type} · {assetId}
            </span>
          </div>
          <div className="flex items-center gap-1 pl-1 shrink-0">
            {isSound && (
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                className="h-6 w-6 min-w-6"
                title={playingAudioId === assetId ? 'Stop audio' : 'Play audio'}
                onClick={(event: any) => {
                  event.stopPropagation();
                  void playAsset(asset);
                }}
              >
                {playingAudioId === assetId ? (
                  <Square size={10} fill="currentColor" />
                ) : (
                  <Play size={11} fill="currentColor" />
                )}
              </Button>
            )}
            {isAnimation && (
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                className="h-6 w-6 min-w-6 text-primary"
                title="Preview animation"
                onClick={(event: any) => {
                  event.stopPropagation();
                  setPreviewingAnimation({
                    id: assetId,
                    name: asset.instanceName,
                  });
                }}
              >
                <Play size={11} fill="currentColor" />
              </Button>
            )}
            {(isImage || isMesh) && (
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                className="h-6 w-6 min-w-6"
                title={isMesh ? 'Preview mesh thumbnail' : 'Preview image'}
                onClick={(event: any) => {
                  event.stopPropagation();
                  setEnlargedImage({ id: assetId, name: asset.instanceName });
                }}
              >
                {isMesh ? <ZoomIn size={11} /> : <ImageIcon size={11} />}
              </Button>
            )}
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              className="h-6 w-6 min-w-6"
              title="Copy asset id"
              onClick={(event: any) => {
                event.stopPropagation();
                void copyAssetId(asset);
              }}
            >
              <Copy size={11} />
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="overflow-hidden">
            <div className="mx-2 mb-2 rounded border border-border-subtle bg-bg-base/80 px-2.5 py-2 text-[9px] text-text-muted">
              <DetailLine label="Path" value={asset.path} />
              <DetailLine label="ID" value={assetId} />
              <DetailLine label="Property" value={asset.propertyName || 'Unknown'} />
              <DetailLine label="Class" value={asset.className || 'Unknown'} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center py-1 px-1 hover:bg-bg-elevated/40 cursor-pointer rounded-sm group select-none"
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="mr-2 cursor-pointer flex items-center justify-center shrink-0"
          onClick={(event: any) => {
            event.stopPropagation();
            toggleNode(node, !isChecked);
          }}
        >
          <MultiSelectToggle checked={isChecked} indeterminate={isIndeterminate} />
        </div>
        <div className="w-4 h-4 flex items-center justify-center shrink-0 mr-1">
          {(filteredAssets.length > 0 || totalChildren > 0) && (
            <ChevronRight
              size={12}
              className={cn('transition-transform text-text-muted', expanded && 'rotate-90')}
            />
          )}
        </div>
        <div className="w-4 h-4 shrink-0 mr-2 flex items-center justify-center">
          <img
            src={`/icons/${node.className}.png`}
            alt=""
            className="w-full h-full object-contain"
            onError={(event: any) => {
              const target = event.target as HTMLImageElement;
              if (!target.src.endsWith('Object.png')) {
                target.src = '/icons/Object.png';
              } else {
                target.style.display = 'none';
              }
            }}
          />
        </div>
        <span className="text-xs text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">
          {node.name}
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col overflow-hidden">
          {filteredAssets.length > 0 && (
            <div className="flex flex-col">
              {filteredAssets.map((asset, index) => (
                <div
                  key={`${asset.type}:${asset.path}:${asset.propertyName}:${getAssetId(asset)}:${index}`}
                >
                  {renderAssetRow(asset, index)}
                </div>
              ))}
            </div>
          )}

          {node.children.map((child, index) => (
            <ExplorerTreeNode
              key={`${child.referent}-${index}`}
              node={child}
              level={level + 1}
              config={config}
              selectedAssetIds={selectedAssetIds}
              toggleAsset={toggleAsset}
              toggleNode={toggleNode}
              getAllAssetIds={getAllAssetIds}
              setEnlargedImage={setEnlargedImage}
              setPreviewingAnimation={setPreviewingAnimation}
              activeAssetFilters={activeAssetFilters}
              playingAudioId={playingAudioId}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1 first:pt-0 last:pb-0">
      <div className="text-[8px] font-semibold uppercase tracking-normal text-text-muted/70">
        {label}
      </div>
      <div className="mt-0.5 select-text whitespace-normal wrap-break-word text-[10px] leading-snug text-text-secondary">
        {value}
      </div>
    </div>
  );
}
