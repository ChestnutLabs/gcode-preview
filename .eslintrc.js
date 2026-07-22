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
