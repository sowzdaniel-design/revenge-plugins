0s
Run node ./build.mjs
Successfully built Read All!
Successfully built Super Reaction Tweaks!
Failed to build plugin... Error: Transform failed with 20 errors:
/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts:283:6: ERROR: The symbol "DEFAULT_SETTINGS" has already been declared
/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts:286:6: ERROR: The symbol "getSettings" has already been declared
/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts:292:4: ERROR: The symbol "avatarUnpatch" has already been declared
/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts:293:4: ERROR: The symbol "bannerUnpatch" has already been declared
/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts:295:6: ERROR: The symbol "MAX_TREE_DEPTH" has already been declared
...
    at failureErrorWithLog (/home/runner/work/revenge-plugins/revenge-plugins/node_modules/.pnpm/esbuild@0.16.17/node_modules/esbuild/lib/main.js:1604:15)
    at /home/runner/work/revenge-plugins/revenge-plugins/node_modules/.pnpm/esbuild@0.16.17/node_modules/esbuild/lib/main.js:837:29
    at responseCallbacks.<computed> (/home/runner/work/revenge-plugins/revenge-plugins/node_modules/.pnpm/esbuild@0.16.17/node_modules/esbuild/lib/main.js:701:9)
    at handleIncomingPacket (/home/runner/work/revenge-plugins/revenge-plugins/node_modules/.pnpm/esbuild@0.16.17/node_modules/esbuild/lib/main.js:756:9)
    at Socket.readFromStdout (/home/runner/work/revenge-plugins/revenge-plugins/node_modules/.pnpm/esbuild@0.16.17/node_modules/esbuild/lib/main.js:677:7)
    at Socket.emit (node:events:524:28)
    at addChunk (node:internal/streams/readable:561:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
    at Readable.push (node:internal/streams/readable:392:5)
    at Pipe.onStreamRead (node:internal/stream_base_commons:191:23) {
  errors: [
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "DEFAULT_SETTINGS" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "getSettings" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "avatarUnpatch" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "bannerUnpatch" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "MAX_TREE_DEPTH" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "findImageUrlInTree" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "getMediaManager" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "downloadImageUrl" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "closeViewer" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "ImageViewerModal" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "openImageViewer" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "currentViewerUrl" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "setViewerUrlExternally" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "rootPatchUnpatch" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "RootOverlay" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "mountModal" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "loggedMissingUrl" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "patchTappableImage" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'The symbol "SettingsComponent" has already been declared'
    },
    {
      detail: undefined,
      id: '',
      location: [Object],
      notes: [Array],
      pluginName: '',
      text: 'Multiple exports with the same name "default"'
    }
  ],
  warnings: [],
  code: 'PLUGIN_ERROR',
  plugin: 'esbuild',
  hook: 'transform',
  id: '/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts',
  watchFiles: [
    '/home/runner/work/revenge-plugins/revenge-plugins/plugins/view-icons/src/index.ts'
  ]
}
Error: Process completed with exit code 1.
