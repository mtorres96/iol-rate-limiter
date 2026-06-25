import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config only — ESLint 10 dropped legacy .eslintrc.
export default tseslint.config(
  // Generated/build output: never lint it (ESLint flat config does NOT read
  // .gitignore, so the gitignored coverage/dist artifacts must be excluded here
  // or `eslint .` would flag generated files and the lint gate could never pass).
  { ignores: ['coverage/**', 'dist/**'] },
  ...tseslint.configs.recommended,
  prettier, // LAST: disables ESLint stylistic rules that conflict with Prettier.
);
