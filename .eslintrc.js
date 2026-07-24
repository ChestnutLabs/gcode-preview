/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error'],
    '@typescript-eslint/no-unsafe-declaration-merging': 'off'
  },
  ignorePatterns: ['dist'],
  env: {
    browser: true
  },
  overrides: [
    // Electron consumer-smoke main process is intentionally CommonJS (Electron default).
    {
      files: ['tools/consumer-smoke/electron-app/**/*.js'],
      env: { node: true, browser: false },
      parserOptions: { sourceType: 'script' },
      rules: {
        '@typescript-eslint/no-require-imports': 'off'
      }
    },
    // DD-002 §5 dependency guardrails — reusable packages must not import renderers,
    // frameworks, or consumer applications; lower layers never import higher layers.
    {
      files: ['packages/toolpath-core/**/*.ts', 'packages/toolpath-core/**/*.mts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['three', 'three/*'], message: 'toolpath-core must not depend on three (DD-002 §4).' },
              { group: ['vue', 'vue/*'], message: 'toolpath-core must not depend on Vue (DD-002 §4).' },
              { group: ['lil-gui'], message: 'toolpath-core must not depend on UI libraries (DD-002 §4).' },
              {
                group: ['@chestnutlabs/gcode-*'],
                message: 'toolpath-core is the lowest layer; it must not import higher packages (DD-002 §4).'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['../../../*'],
                message: 'toolpath-core must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-parser/**/*.ts', 'packages/gcode-parser/**/*.mts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['three', 'three/*'], message: 'gcode-parser must not depend on three (DD-002 §4).' },
              { group: ['vue', 'vue/*'], message: 'gcode-parser must not depend on Vue (DD-002 §4).' },
              { group: ['lil-gui'], message: 'gcode-parser must not depend on UI libraries (DD-002 §4).' },
              {
                group: ['@chestnutlabs/gcode-renderer*', '@chestnutlabs/gcode-preview*'],
                message: 'The parser must not import renderers or the viewer facade (DD-002 §4).'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-parser must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-dialects/**/*.ts', 'packages/gcode-dialects/**/*.mts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['three', 'three/*'], message: 'gcode-dialects must not depend on three (DD-002 §4).' },
              { group: ['vue', 'vue/*'], message: 'gcode-dialects must not depend on Vue (DD-002 §4).' },
              { group: ['lil-gui'], message: 'gcode-dialects must not depend on UI libraries (DD-002 §4).' },
              {
                group: ['@chestnutlabs/gcode-parser*', '@chestnutlabs/gcode-renderer*', '@chestnutlabs/gcode-preview*'],
                message:
                  'gcode-dialects depends only on toolpath-core (DD-005 §4.5) — the parser imports IT, never the reverse.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-dialects must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-containers/**/*.ts', 'packages/gcode-containers/**/*.mts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['three', 'three/*'], message: 'gcode-containers must not depend on three (DD-002 §4).' },
              { group: ['vue', 'vue/*'], message: 'gcode-containers must not depend on Vue (DD-002 §4).' },
              {
                group: [
                  '@chestnutlabs/gcode-parser*',
                  '@chestnutlabs/gcode-dialects*',
                  '@chestnutlabs/gcode-renderer*',
                  '@chestnutlabs/gcode-preview*'
                ],
                message: 'gcode-containers depends only on toolpath-core (DD-005 §4.5).'
              },
              {
                group: ['node:fs*', 'fs', 'node:child_process', 'child_process', 'node:net', 'node:http*'],
                message: 'gcode-containers is in-memory only — no filesystem, process, or network access (DD-005 §7).'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-containers must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-containers/src/__tests__/**/*.ts', 'packages/gcode-dialects/src/__tests__/**/*.ts'],
      rules: {
        // Tests read committed fixtures and drive the real parser to produce IRs;
        // the shipped libraries keep the full restrictions above.
        'no-restricted-imports': 'off'
      }
    },
    {
      // src only: the vitest config is node-side tooling, not shipped code.
      files: ['packages/gcode-preview-core/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              // The framework-neutral controller (DD-007 §4.6): NO framework may enter.
              {
                group: ['vue', 'vue/*', 'react', 'react/*', 'react-dom*', 'svelte', 'svelte/*'],
                message:
                  'gcode-preview-core is framework-neutral (DD-007 §4.6) — adapters bridge, core never imports them.'
              },
              {
                group: ['pinia', 'pinia/*', 'vue-router', 'vue-router/*'],
                message: 'No state/router libs (DD-007 §4.4).'
              },
              { group: ['lil-gui'], message: 'gcode-preview-core ships no UI chrome (DD-007 §3).' },
              {
                group: ['three', 'three/*'],
                message: 'gcode-preview-core consumes the renderer package, never three directly (DD-002 §4).'
              },
              {
                group: ['@chestnutlabs/gcode-dialects*', '@chestnutlabs/gcode-containers*'],
                message: 'Dialects/containers run inside the worker (DD-005 §4.5) — the controller never imports them.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
                message: 'gcode-preview-core is browser-side only (DD-007 §7).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-preview-core must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      // src only (the vitest config is node-side tooling). .svelte files are outside
      // eslint's TS parser; the shipped TS surface carries the boundary rules.
      files: ['packages/gcode-preview-svelte/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              // svelte types only in the component (raw-shipped); the TS surface stays framework-free.
              {
                group: ['vue', 'vue/*', 'react', 'react/*', 'react-dom*', 'svelte', 'svelte/*'],
                message:
                  'gcode-preview-svelte TS surface is structural-only (DD-007 §4.6) — the raw .svelte component is the only svelte-importing file.'
              },
              { group: ['lil-gui'], message: 'gcode-preview-svelte ships no UI chrome (DD-007 §3).' },
              {
                group: ['three', 'three/*'],
                message: 'gcode-preview-svelte consumes the renderer package, never three directly (DD-002 §4).'
              },
              {
                group: ['@chestnutlabs/gcode-dialects*', '@chestnutlabs/gcode-containers*'],
                message:
                  'Dialects/containers run inside the worker (DD-005 §4.5) — the Svelte layer never imports them.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
                message: 'gcode-preview-svelte is browser-side only (DD-007 §7).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-preview-svelte must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      // src only (the vitest config is node-side tooling).
      files: ['packages/gcode-preview-react/src/**/*.ts', 'packages/gcode-preview-react/src/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              // react IS allowed here — this adapter's one framework dependency (DD-007 §4.6).
              {
                group: ['vue', 'vue/*', 'svelte', 'svelte/*'],
                message:
                  'gcode-preview-react bridges React only (DD-007 §4.6) — other frameworks have their own adapters.'
              },
              {
                group: ['redux', 'redux/*', 'react-redux*', 'zustand*', 'react-router*'],
                message: 'gcode-preview-react must stay store/router-free (DD-007 §4.4) — hosts own app state.'
              },
              { group: ['lil-gui'], message: 'gcode-preview-react ships no UI chrome (DD-007 §3).' },
              {
                group: ['three', 'three/*'],
                message: 'gcode-preview-react consumes the renderer package, never three directly (DD-002 §4).'
              },
              {
                group: ['@chestnutlabs/gcode-dialects*', '@chestnutlabs/gcode-containers*'],
                message: 'Dialects/containers run inside the worker (DD-005 §4.5) — the React layer never imports them.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
                message: 'gcode-preview-react is browser-side only (DD-007 §7).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-preview-react must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      // The custom-element adapter is framework-FREE — no framework is allowed here (DD-009 §4.5).
      files: ['packages/gcode-preview-element/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'vue', 'vue/*', 'svelte', 'svelte/*'],
                message:
                  'gcode-preview-element is framework-free (DD-009 §4.5) — it wraps the neutral controller, never a framework.'
              },
              {
                group: ['redux', 'redux/*', 'react-redux*', 'zustand*', 'react-router*'],
                message: 'gcode-preview-element must stay store/router-free (DD-007 §4.4) — hosts own app state.'
              },
              { group: ['lil-gui'], message: 'gcode-preview-element ships no UI chrome (DD-007 §3).' },
              {
                group: ['three', 'three/*'],
                message: 'gcode-preview-element consumes the renderer package, never three directly (DD-002 §4).'
              },
              {
                group: ['@chestnutlabs/gcode-dialects*', '@chestnutlabs/gcode-containers*'],
                message: 'Dialects/containers run inside the worker (DD-005 §4.5) — the element never imports them.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
                message: 'gcode-preview-element is browser-side only (DD-007 §7).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-preview-element must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-preview-vue/**/*.ts', 'packages/gcode-preview-vue/**/*.vue'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              // vue IS allowed here — this package's one framework dependency (DD-007 §4.4).
              {
                group: ['pinia', 'pinia/*', 'vue-router', 'vue-router/*'],
                message: 'gcode-preview-vue must stay store/router-free (DD-007 §4.4) — hosts own app state.'
              },
              { group: ['lil-gui'], message: 'gcode-preview-vue ships no UI chrome (DD-007 §3).' },
              {
                group: ['three', 'three/*'],
                message: 'gcode-preview-vue consumes the renderer package, never three directly (DD-002 §4).'
              },
              {
                group: ['@chestnutlabs/gcode-dialects*', '@chestnutlabs/gcode-containers*'],
                message: 'Dialects/containers run inside the worker (DD-005 §4.5) — the Vue layer never imports them.'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['node:*', 'fs', 'child_process', 'net', 'http', 'https'],
                message: 'gcode-preview-vue is browser-side only (DD-007 §7).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-preview-vue must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['packages/gcode-renderer-three/**/*.ts', 'packages/gcode-renderer-three/**/*.mts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              // three IS allowed here (DD-002 §4) — the renderer's one framework dependency.
              { group: ['vue', 'vue/*'], message: 'the renderer must not depend on Vue (DD-002 §4).' },
              { group: ['lil-gui'], message: 'the renderer must not depend on UI libraries (DD-002 §4).' },
              {
                group: ['@chestnutlabs/gcode-parser', '@chestnutlabs/gcode-parser/*', '@chestnutlabs/gcode-dialects*'],
                message:
                  'The renderer consumes ToolpathIR only — never parser internals or dialect recognizers (DD-004 §4.1).'
              },
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'No reusable package may import AnyBridge (DD-002 §4 core rule).'
              },
              {
                group: ['../../../*'],
                message: 'gcode-renderer-three must not reach outside its package (DD-002 §4).'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['*anybridge*', '*AnyBridge*'],
                message: 'The reusable viewer library must never import AnyBridge (DD-002 §4 core rule).'
              }
            ]
          }
        ]
      }
    }
  ]
};
