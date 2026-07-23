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
  ignorePatterns: ['dist', 'examples', 'demo/lib', 'demo/js/vue.esm-browser.prod.js'],
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
