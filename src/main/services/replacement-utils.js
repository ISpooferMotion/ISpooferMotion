'use strict';

// --- Upload name helpers ---

function buildFinalUploadName(entry, data = {}) {
  let finalName = String(entry?.name || '');

  if (data.renameFind) {
    finalName = finalName.split(data.renameFind).join(data.renameReplace || '');
  }
  if (data.renamePrefix) {
    finalName = data.renamePrefix + finalName;
  }
  if (data.renameSuffix) {
    finalName += data.renameSuffix;
  }

  return finalName;
}

function describeRenameRules(data = {}) {
  const rules = [];
  if (data.renameFind) {
    rules.push(`find "${data.renameFind}" -> "${data.renameReplace || ''}"`);
  }
  if (data.renamePrefix) rules.push(`prefix "${data.renamePrefix}"`);
  if (data.renameSuffix) rules.push(`suffix "${data.renameSuffix}"`);
  return rules.length > 0 ? rules.join(', ') : 'none';
}

// --- Duplicate final-name detection ---

function findDuplicateFinalNames(entries, data = {}) {
  const byFinalName = new Map();

  for (const entry of entries || []) {
    const finalName = buildFinalUploadName(entry, data);
    const key = finalName.trim().toLowerCase();
    const group = byFinalName.get(key) || { finalName, sources: [] };
    group.sources.push({ id: String(entry.id), name: String(entry.name || '') });
    byFinalName.set(key, group);
  }

  return [...byFinalName.values()].filter((group) => group.sources.length > 1);
}

function buildDuplicateFinalNamesError(entries, data = {}, assetLabel = 'assets') {
  const duplicates = findDuplicateFinalNames(entries, data);
  if (duplicates.length === 0) return '';

  const duplicateList = duplicates
    .map((group) => {
      const sources = group.sources
        .map((source) => `  - ID ${source.id}: ${source.name}`)
        .join('\n');
      return `- Final name "${group.finalName}":\n${sources}`;
    })
    .join('\n');

  return (
    `Skip Assets You Own cannot safely continue because multiple source ${assetLabel} resolve to the same final name.\n\n` +
    `Duplicate final names:\n${duplicateList}\n\n` +
    `Active rename rules: ${describeRenameRules(data)}\n\n` +
    `Fix this by renaming the source ${assetLabel} or changing the rename settings so every replacement target is unique.`
  );
}

module.exports = {
  buildDuplicateFinalNamesError,
  buildFinalUploadName,
  describeRenameRules,
  findDuplicateFinalNames,
};
