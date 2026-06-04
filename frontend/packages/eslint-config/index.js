module.exports = {
  env: {
    browser: true,
    node: true,
    es2024: true
  },
  parser: "vue-eslint-parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  extends: [
    "eslint:recommended",
    "plugin:vue/recommended",
    "turbo",
    "prettier"
  ],
  globals: {
    __API_BASE__: "readonly"
  },
  rules: {
    "vue/multi-word-component-names": "off",
    "vue/no-v-html": "off",
    "vue/no-mutating-props": "warn",
    "no-dupe-keys": "warn",
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
  }
};
