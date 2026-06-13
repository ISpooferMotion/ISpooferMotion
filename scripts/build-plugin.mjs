#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pluginRoot = join(root, 'src-tauri', 'plugin');

function expandPluginIncludes(source, fromFile, stack = []) {
  return source.replace(/^--#include\s+"([^"]+)"\s*$/gm, (_match, includePath) => {
    const resolvedInclude = resolve(dirname(fromFile), includePath);
    const normalizedPluginRoot = resolve(pluginRoot).toLowerCase();
    const normalizedInclude = resolvedInclude.toLowerCase();

    if (
      normalizedInclude !== normalizedPluginRoot &&
      !normalizedInclude.startsWith(`${normalizedPluginRoot}\\`) &&
      !normalizedInclude.startsWith(`${normalizedPluginRoot}/`)
    ) {
      throw new Error(`Refusing to include file outside plugin source: ${includePath}`);
    }

    if (stack.includes(resolvedInclude)) {
      throw new Error(
        `Circular plugin include detected: ${[...stack, resolvedInclude].join(' -> ')}`,
      );
    }

    const includedSource = readFileSync(resolvedInclude, 'utf8');
    const expandedSource = expandPluginIncludes(includedSource, resolvedInclude, [
      ...stack,
      resolvedInclude,
    ]);

    return [
      `-- BEGIN include: ${includePath}`,
      expandedSource.trimEnd(),
      `-- END include: ${includePath}`,
    ].join('\n');
  });
}

async function buildPlugin() {
  try {
    const entryPath = join(pluginRoot, 'plugin.luau');
    const rawLuaSource = expandPluginIncludes(readFileSync(entryPath, 'utf8'), entryPath);

    const safeSource = rawLuaSource.replace(/]]>/g, ']]]]><![CDATA[>');

    const referent = 'RBXE00000000000000000000000000000001';
    const rbxmx = `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<External>null</External>
	<External>nil</External>
	<Item class="Script" referent="${referent}">
		<Properties>
			<string name="Name">ISpooferMotion</string>
			<ProtectedString name="Source"><![CDATA[${safeSource}]]></ProtectedString>
			<bool name="Disabled">false</bool>
		</Properties>
	</Item>
</roblox>
`;

    const outDir = join(root, 'dist-plugin');
    mkdirSync(outDir, { recursive: true });

    const pluginBuildDir = join(root, 'plugin-build');
    mkdirSync(pluginBuildDir, { recursive: true });

    const generatedSourcePath = join(pluginBuildDir, 'ISpooferMotion.generated.luau');
    writeFileSync(generatedSourcePath, rawLuaSource, 'utf8');

    const outPath = join(outDir, 'ISpooferMotion.rbxmx');
    writeFileSync(outPath, rbxmx, 'utf8');

    const kb = (rawLuaSource.length / 1024).toFixed(1);

    console.log(`    Plugin built successfully`);
    console.log(`    Source      : src-tauri/plugin/plugin.luau + includes  (${kb} KB)`);
    console.log(`    Lint source : plugin-build/ISpooferMotion.generated.luau`);
    console.log(`    Output      : dist-plugin/ISpooferMotion.rbxmx`);
    console.log(``);
  } catch (err) {
    console.error('Failed to build plugin:', err);
    process.exit(1);
  }
}

buildPlugin();
