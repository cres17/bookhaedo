import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default tseslint.config(
 {ignores:['node_modules/**','dist/**','docs/**','output/**','frontend/public/**','test-results/**','playwright-report/**']},
 ...tseslint.configs.recommended,
 ...vue.configs['flat/essential'],
 {files:['**/*.vue'],languageOptions:{parserOptions:{parser:tseslint.parser,extraFileExtensions:['.vue']}}},
 {rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':'off','@typescript-eslint/no-non-null-assertion':'off','vue/multi-word-component-names':'off'}},
);
