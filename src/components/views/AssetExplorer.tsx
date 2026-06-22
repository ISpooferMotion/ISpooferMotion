import { Button, MultiSelectDropdown, Spinner } from '@codycon/ism-library';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, FileUp, Filter, FolderOpen, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useConfig } from '../../contexts/ConfigContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useStudioAssetPoll } from '../../hooks/useStudioAssetPoll';
import { useSpooferStore } from '../../stores/spooferStore';
import type { ScriptRefProgressPayload, TauriEventPayload } from '../../types/tauriEvents';
import type { PluginAsset, PluginAssetStore } from '../../utils/pluginBridge';
import { stopRobloxAudio } from '../../utils/robloxAudio';
import type { ParsedAssetRef, ParseProgress, RbxInstance } from '../../utils/robloxPlaceParser';
import { parsePlaceBytesInWorker, parsePlaceUrlInWorker } from '../../utils/robloxPlaceParser';
import { logIsm } from '../../utils/robloxProfiles';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { ExplorerTreeNode, getAssetId } from './asset-explorer/ExplorerTree';

interface AssetExplorerProps {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}

const ASSET_TYPE_OPTIONS = [
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Images' },
  { value: 'animation', label: 'Animations' },
  { value: 'mesh', label: 'Meshes' },
];

const ASSET_EXPLORER_WIDTH = 340;
const AnimationPreview = lazy(() => import('../AnimationPreview'));

function dedupePluginAssets(assets: PluginAsset[]): PluginAsset[] {
  // filter out exact duplicates so we don't spam the tree view
  const seen = new Set<string>();
  const deduped: PluginAsset[] = [];

  for (const asset of assets) {
    const key = [
      asset.assetId ?? '',
      asset.fullName ?? '',
      asset.script ?? '',
      asset.property ?? '',
      asset.callType ?? '',
      asset.sourceHint ?? '',
      asset.kind ?? '',
    ].join('\u0000');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }

  return deduped;
}

function dedupeParsedAssets(assets: ParsedAssetRef[]): ParsedAssetRef[] {
  const byKey = new Map<string, ParsedAssetRef & { instanceCount?: number }>();

  for (const asset of assets) {
    const key = [
      asset.type,
      asset.assetId,
      asset.path,
      asset.propertyName,
      asset.className,
      asset.instanceName,
    ].join('\u0000');
    const existing = byKey.get(key);
    if (existing) {
      existing.instanceCount = (existing.instanceCount ?? 1) + 1;
    } else {
      byKey.set(key, { ...asset });
    }
  }

  return Array.from(byKey.values());
}

function pluginAssetsToNode(
  folderName: string,
  className: string,
  assets: PluginAsset[],
  assetType: ParsedAssetRef['type'],
): RbxInstance {
  // turn flat plugin asset lists into the same nested tree structure we use for rbxl files
  return {
    referent: `studio-${folderName}`,
    className,
    name: folderName,
    assets: dedupePluginAssets(assets).map(
      (a: PluginAsset): ParsedAssetRef => ({
        type: assetType,
        assetId: a.assetId ?? '',
        rawValue: `rbxassetid://${a.assetId}`,
        className: a.kind ?? className,
        instanceName: a.name ?? a.assetId ?? '',
        propertyName: a.property ?? a.callType ?? a.sourceHint ?? '',
        path: a.fullName ?? a.script ?? folderName,
      }),
    ),
    children: [],
  };
}

function hidePluginAssets(nodes: RbxInstance[]): RbxInstance[] {
  return nodes
    .map((node) => ({
      ...node,
      assets: dedupeParsedAssets(node.assets.filter((asset) => asset.type !== 'plugin')),
      children: hidePluginAssets(node.children),
    }))
    .filter((node) => node.assets.length > 0 || node.children.length > 0);
}

const VALID_ROOT_SERVICES = new Set([
  'Workspace',
  'Lighting',
  'ReplicatedFirst',
  'ReplicatedStorage',
  'ServerScriptService',
  'ServerStorage',
  'StarterGui',
  'StarterPack',
  'StarterPlayer',
  'SoundService',
  'Teams',
  'MaterialService',
  'StudioSession',
]);

export default function AssetExplorer({ isOpen, setIsOpen }: AssetExplorerProps) {
  const [parseState, setParseState] = useState<ParseProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [previewingAnimation, setPreviewingAnimation] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [activeAssetFilters, setActiveAssetFilters] = useState<string[]>([]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const [resolvingScriptRefs, setResolvingScriptRefs] = useState(false);
  const [resolverProgress, setResolverProgress] = useState<{
    resolved: number;
    total: number;
  } | null>(null);

  const [, setUnknownScriptRefs] = useState<PluginAsset[]>([]);

  const { config } = useConfig();
  const {
    rootInstances,
    setRootInstances,
    loadedFileName,
    setLoadedFileName,
    setParsingFileName,
    selectedAssetIds,
    setSelectedAssetIds,
    keyframeWarningCount,
    setKeyframeWarningCount,
  } = useSpooferStore();

  const { studioConnected, scanStatus } = useStudioConnectionState();
  const lastStudioSnapshotRef = useRef('');

  useEffect(() => {
    const handlePlaybackChange = (event: Event) => {
      setPlayingAudioId((event as CustomEvent<{ assetId: string | null }>).detail.assetId);
    };
    window.addEventListener('ism-audio-playback-change', handlePlaybackChange);
    return () => {
      window.removeEventListener('ism-audio-playback-change', handlePlaybackChange);
      stopRobloxAudio();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisten = listen(
      'script-ref-progress',
      (event: TauriEventPayload<ScriptRefProgressPayload>) => {
        setResolverProgress({
          resolved: event.payload.resolved ?? 0,
          total: event.payload.total ?? 0,
        });
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const displayedInstances = useMemo(() => {
    const cleanRootInstances = rootInstances.filter(
      (node) => VALID_ROOT_SERVICES.has(node.className) || node.referent.startsWith('studio-'),
    );
    return hidePluginAssets(cleanRootInstances);
  }, [rootInstances]);

  const processStudioData = useCallback(
    (
      anims: PluginAssetStore,
      sounds: PluginAssetStore,
      images: PluginAssetStore,
      meshes: PluginAssetStore,
      scriptRefs: PluginAssetStore,
    ) => {
      const animationAssets = anims.assets ?? [];
      const soundAssets = sounds.assets ?? [];
      const imageAssets = images.assets ?? [];
      const meshAssets = meshes.assets ?? [];
      const scriptRefAssets = scriptRefs.assets ?? [];
      const snapshotEntries: Array<[string, PluginAsset[]]> = [
        ['animation', animationAssets],
        ['audio', soundAssets],
        ['image', imageAssets],
        ['mesh', meshAssets],
        ['script_ref', scriptRefAssets],
      ];

      // quickly check if anything actually changed before we rebuild the entire tree
      const snapshot =
        snapshotEntries
          .flatMap(([type, assets]) =>
            assets.map((asset) => `${type}:${asset.assetId ?? ''}`).sort(),
          )
          .join('|') || 'EMPTY';
      if (snapshot === lastStudioSnapshotRef.current) return;
      lastStudioSnapshotRef.current = snapshot;

      const buildTree = (resolvedMap: Record<string, string> = {}) => {
        const children: RbxInstance[] = [];

        const appendResolved = (originalAssets: PluginAsset[], targetType: string) => {
          const arr = [...originalAssets];
          const resolved = scriptRefAssets
            .filter((asset) => asset.assetId && resolvedMap[asset.assetId] === targetType)
            .map((asset) => ({ ...asset, type: targetType }));
          for (const a of resolved) {
            arr.push(a);
          }
          return arr;
        };

        const finalAnims = appendResolved(animationAssets, 'animation');
        const finalSounds = appendResolved(soundAssets, 'audio');
        const finalImages = appendResolved(imageAssets, 'image');
        const finalMeshes = appendResolved(meshAssets, 'mesh');

        const kfCount =
          scriptRefAssets.filter((asset) => asset.kind === 'UnuploadedAnimation').length || 0;
        setKeyframeWarningCount(kfCount);

        const unknownRefs = scriptRefAssets.filter((asset) => {
          if (asset.kind === 'UnuploadedAnimation') return false;

          const resolved = asset.assetId ? resolvedMap[asset.assetId] : undefined;
          if (
            resolved === 'animation' ||
            resolved === 'audio' ||
            resolved === 'image' ||
            resolved === 'mesh'
          )
            return false;

          if (resolved === 'false_positive') return false;

          return true;
        });
        setUnknownScriptRefs(unknownRefs);

        if (finalAnims.length > 0)
          children.push(pluginAssetsToNode('Animations', 'Model', finalAnims, 'animation'));
        if (finalSounds.length > 0)
          children.push(pluginAssetsToNode('Sounds', 'Model', finalSounds, 'audio'));
        if (finalImages.length > 0)
          children.push(pluginAssetsToNode('Images', 'Model', finalImages, 'image'));
        if (finalMeshes.length > 0)
          children.push(pluginAssetsToNode('Meshes', 'Model', finalMeshes, 'mesh'));
        if (unknownRefs.length > 0)
          children.push(
            pluginAssetsToNode(
              'Unverified Script IDs',
              'Folder',
              unknownRefs,
              'script_ref' as ParsedAssetRef['type'],
            ),
          );

        const studioNode: RbxInstance = {
          referent: 'studio-root',
          className: 'StudioSession',
          name: 'Studio Session',
          assets: [],
          children,
        };

        setRootInstances((prev) => [
          studioNode,
          ...prev.filter((n) => n.referent !== 'studio-root'),
        ]);
      };

      buildTree({});
      setLoadedFileName((prev) => prev ?? 'Studio Session');

      if (scriptRefAssets.length > 0) {
        // if we got script refs, try to resolve their actual asset type on the rust backend
        setResolvingScriptRefs(true);
        const uniqueIds = Array.from(
          new Set<string>(
            scriptRefAssets
              .map((asset) => asset.assetId)
              .filter((assetId): assetId is string => Boolean(assetId)),
          ),
        );
        setResolverProgress({ resolved: 0, total: uniqueIds.length });

        if (!isTauriRuntime()) {
          setResolvingScriptRefs(false);
          setResolverProgress(null);
          buildTree({});
          return;
        }

        invoke<Record<string, string>>('resolve_script_references', {
          assetIds: uniqueIds,
        })
          .then((resolvedMap) => {
            setResolvingScriptRefs(false);
            setResolverProgress(null);
            buildTree(resolvedMap);
          })
          .catch((err) => {
            logIsm('error', `Failed to resolve script references: ${String(err)}`);
            setResolvingScriptRefs(false);
            setResolverProgress(null);
            buildTree({});
          });
      }
    },
    [setKeyframeWarningCount, setRootInstances, setLoadedFileName],
  );

  useStudioAssetPoll(studioConnected, config.advanced.pluginPort || '14285', (bundle) => {
    processStudioData(bundle.anims, bundle.sounds, bundle.images, bundle.meshes, bundle.scriptRefs);
  });

  const toggleAsset = useCallback(
    (assetId: string, checked: boolean) => {
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(assetId);
        else next.delete(assetId);
        return next;
      });
    },
    [setSelectedAssetIds],
  );

  const getAllAssetIds = useCallback(
    (node: RbxInstance): string[] => {
      let ids: string[] = node.assets
        .filter((a) => activeAssetFilters.length === 0 || activeAssetFilters.includes(a.type))
        .map((a) => getAssetId(a))
        .filter(Boolean);
      for (const child of node.children) {
        ids = ids.concat(getAllAssetIds(child));
      }
      return ids;
    },
    [activeAssetFilters],
  );

  const toggleNode = useCallback(
    (node: RbxInstance, checked: boolean) => {
      const ids = getAllAssetIds(node);
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [getAllAssetIds, setSelectedAssetIds],
  );

  const unlistenRef = useRef<(() => void) | null>(null);

  const loadFromPath = async (filePath: string) => {
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    if (!fileName.endsWith('.rbxl') && !fileName.endsWith('.rbxlx')) {
      logIsm('warn', `Only .rbxl and .rbxlx files are supported. Got: "${fileName}"`);
      return;
    }
    setParsingFileName(fileName);
    setParseState({ phase: 'Reading file', current: 0, total: 1 });
    try {
      let result;
      // use the rust worker to parse the file quickly without blocking the UI thread
      if (isTauriRuntime()) {
        try {
          const bytes = await readFile(filePath);
          setParseState({
            phase: 'Reading file',
            current: bytes.byteLength,
            total: bytes.byteLength,
          });
          result = await parsePlaceBytesInWorker(bytes, fileName, setParseState);
        } catch (readError) {
          logIsm(
            'warn',
            `Direct file read failed, falling back to local URL parser: ${String(readError)}`,
          );
        }
      }

      if (!result) {
        const fileUrl = convertFileSrc(filePath);
        result = await parsePlaceUrlInWorker(fileUrl, fileName, setParseState);
      }

      for (const w of result.warnings) {
        logIsm('warn', w);
      }

      setSelectedAssetIds(new Set());
      setRootInstances(result.rootInstances);
      setLoadedFileName(fileName);

      let totalAssets = 0;
      const countAssets = (node: RbxInstance) => {
        totalAssets += node.assets.length;
        node.children.forEach(countAssets);
      };
      result.rootInstances.forEach(countAssets);

      logIsm(
        'success',
        `Loaded "${fileName}" - ${totalAssets} asset reference${totalAssets !== 1 ? 's' : ''}.`,
      );
    } catch (err) {
      logIsm('error', `Failed to read "${fileName}": ${String(err)}`);
    } finally {
      setParseState(null);
      setParsingFileName(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let currentWindow;
    try {
      currentWindow = getCurrentWindow();
    } catch {
      return;
    }
    currentWindow
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setIsDragOver(true);
        } else if (
          type === 'leave' ||
          (type as string) === 'cancelled' ||
          (type as string) === 'dropCancelled'
        ) {
          setIsDragOver(false);
        } else if (type === 'drop') {
          setIsDragOver(false);
          const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
          const placeFile = paths.find((p) => p.endsWith('.rbxl') || p.endsWith('.rbxlx'));
          if (placeFile) {
            loadFromPath(placeFile);
          } else if (paths.length > 0) {
            logIsm('warn', `Only .rbxl and .rbxlx files are supported.`);
          }
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await openFilePicker({
        multiple: false,
        filters: [{ name: 'Roblox Place', extensions: ['rbxl', 'rbxlx'] }],
      });
      if (!selected) return;
      const filePath =
        typeof selected === 'string' ? selected : (selected as { path: string }).path;
      if (filePath) await loadFromPath(filePath);
    } catch (err) {
      if (String(err).toLowerCase().includes('cancel')) return;
      logIsm('error', `File picker error: ${String(err)}`);
    }
  };

  return (
    <motion.div
      initial={false}
      animate={{
        width: isOpen ? ASSET_EXPLORER_WIDTH : 0,
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 35 }}
      className="h-full bg-bg-surface border-l border-border-subtle flex flex-col shrink-0 overflow-hidden relative"
    >
      {}
      <AnimatePresence>
        {isDragOver && isOpen && (
          <motion.div
            key="asset-drag-drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-bg-surface/90 backdrop-blur-sm border-2 border-dashed border-primary m-1 rounded-[var(--radius-md)] pointer-events-none"
          >
            <div className="flex flex-col items-center gap-3 text-primary">
              <FileUp size={28} />
              <span className="font-semibold text-sm">Drop .rbxl / .rbxlx</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {}
      <div className="h-12 border-b border-border-subtle flex items-center justify-between px-2 shrink-0">
        <AnimatePresence mode="wait">
          {isOpen && (
            <motion.div
              key="title"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-2 pl-1 overflow-hidden"
            >
              <span className="text-sm font-bold tracking-wide text-text-primary whitespace-nowrap">
                Explorer
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1.5 justify-end z-[100]">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            className="h-7 w-7 min-w-7 text-text-secondary hover:text-text-primary"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
      </div>

      {}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="asset-explorer-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto scrollbar-hide w-full flex flex-col"
          >
            {resolvingScriptRefs ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted px-6">
                <Spinner size="sm" color="current" />
                <div className="flex flex-col items-center text-center gap-1">
                  <span className="text-xs font-semibold text-text-primary">
                    Resolving Script References
                  </span>
                  {resolverProgress && resolverProgress.total > 0 && (
                    <span className="text-[10px]">
                      {Math.round((resolverProgress.resolved / resolverProgress.total) * 100)}% (
                      {resolverProgress.resolved} / {resolverProgress.total})
                    </span>
                  )}
                </div>
              </div>
            ) : parseState ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted px-6">
                <Spinner size="sm" color="current" />
                <div className="flex flex-col items-center text-center gap-1">
                  <span className="text-xs font-semibold text-text-primary">
                    {parseState.phase}
                  </span>
                  {parseState.total > 1 && (
                    <span className="text-[10px]">
                      {Math.round((parseState.current / parseState.total) * 100)}% (
                      {parseState.phase === 'Reading file'
                        ? `${(parseState.current / 1048576).toFixed(1)}MB / ${(parseState.total / 1048576).toFixed(1)}MB`
                        : `${parseState.current} / ${parseState.total}`}
                      )
                    </span>
                  )}
                  {parseState.eta && (
                    <span className="text-[10px] text-primary/80 font-medium">
                      ETA: {parseState.eta}
                    </span>
                  )}
                </div>
              </div>
            ) : displayedInstances.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.35 }}
                className="flex-1 flex flex-col"
              >
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-text-muted/60 text-xs font-medium select-none text-center">
                    {studioConnected && scanStatus?.scanning ? (
                      <div className="flex flex-col gap-1 items-center">
                        <span className="text-primary font-bold">Scanning Studio...</span>
                        <span className="text-text-muted">
                          {scanStatus.current_service} (
                          {Math.round((scanStatus.scanned / Math.max(1, scanStatus.total)) * 100)}
                          %)
                        </span>
                      </div>
                    ) : studioConnected ? (
                      'Waiting for Studio scan...'
                    ) : (
                      'No place loaded'
                    )}
                  </span>
                </div>
                {}
                <div
                  className="mx-3 mb-3 h-28 flex-shrink-0 flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border-strong hover:border-primary/60 hover:bg-primary/5 transition-colors cursor-pointer text-text-muted hover:text-primary select-none"
                  onClick={handleBrowse}
                >
                  <FolderOpen size={24} className="opacity-60" />
                  <div className="text-center px-4">
                    <p className="text-[11px] font-semibold">Drop or click to browse</p>
                    <p className="text-[9px] mt-1 opacity-60">.rbxl &amp; .rbxlx only</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col h-full">
                {loadedFileName && (
                  <div className="px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-border-subtle">
                    <div className="flex items-center gap-2 text-[10px] text-text-muted">
                      <FolderOpen size={11} />
                      <span className="truncate font-medium">{loadedFileName}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <Filter size={13} className="shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <MultiSelectDropdown
                          options={ASSET_TYPE_OPTIONS}
                          values={activeAssetFilters}
                          onChange={setActiveAssetFilters}
                          placeholder="All asset types"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col flex-1 p-2">
                  {displayedInstances.map((node, i) => (
                    <ExplorerTreeNode
                      key={`${node.referent}-${i}`}
                      node={node}
                      level={0}
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

                {keyframeWarningCount > 0 && (
                  <div className="mx-3 mb-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                    <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                      <span>⚠️</span> Un-uploaded Animations Found
                    </p>
                    <p className="text-[10px] leading-tight opacity-90">
                      {keyframeWarningCount} animation
                      {keyframeWarningCount !== 1 ? 's are' : ' is'} present as raw{' '}
                      <code>KeyframeSequence</code> data. These must be published to Roblox before
                      they can be spoofed.
                    </p>
                  </div>
                )}

                <Button
                  onClick={() => {
                    setRootInstances([]);
                    setLoadedFileName(null);
                    lastStudioSnapshotRef.current = '';
                  }}
                  variant="flat"
                  className="mx-3 mb-3 mt-1 text-[11px]"
                >
                  Clear Explorer
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enlargedImage && (
          <ImageOverlay
            key="enlarged-image"
            assetId={enlargedImage.id}
            onClose={() => setEnlargedImage(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewingAnimation && (
          <Suspense
            key="animation-preview"
            fallback={<AnimationPreviewFallback onClose={() => setPreviewingAnimation(null)} />}
          >
            <AnimationPreview
              assetId={previewingAnimation.id}
              assetName={previewingAnimation.name}
              onClose={() => setPreviewingAnimation(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AnimationPreviewFallback({ onClose }: { onClose: () => void }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 pointer-events-auto"
    >
      <Spinner size="lg" />
    </motion.div>,
    document.body,
  );
}

function ImageOverlay({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    invoke<string | null>('fetch_roblox_thumbnail', { assetId })
      .then((fetchedUrl) => {
        if (fetchedUrl) {
          setUrl(fetchedUrl);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [assetId]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-6 md:p-12 cursor-zoom-out pointer-events-auto"
    >
      <button
        className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={24} />
      </button>
      <div className="relative w-full h-full flex items-center justify-center">
        {url ? (
          <motion.img
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            src={url}
            alt="Enlarged asset"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        ) : error ? (
          <div className="text-white bg-red-500/20 px-4 py-2 rounded text-sm font-medium">
            Failed to load image
          </div>
        ) : (
          <Spinner size="lg" />
        )}
      </div>
    </motion.div>,
    document.body,
  );
}
