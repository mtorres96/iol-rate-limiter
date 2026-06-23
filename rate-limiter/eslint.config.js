import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config only — ESLint 10 dropped legacy .eslintrc.
export default tseslint.config(
  ...tseslint.configs.recommended,
  prettier, // LAST: disables ESLint stylistic rules that conflict with Prettier.
);
