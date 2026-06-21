const esbuild = require('esbuild');

async function buildMain() {
  try {
    await esbuild.build({
      entryPoints: {
        'app': 'src/main/app.ts',
        'preload': 'src/preload/preload.ts'
      },
      bundle: true,
      platform: 'node',
      target: 'node18',
      outdir: 'dist-main',
      external: ['electron', 'keytar', 'luaparse'],
      sourcemap: true,
      minify: process.env.NODE_ENV === 'production',
    });
    console.log('Main process built successfully');
  } catch (error) {
    console.error('Failed to build main process:', error);
    process.exit(1);
  }
}

buildMain();
